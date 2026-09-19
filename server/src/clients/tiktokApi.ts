import { config } from '../config';
import { db } from '../db';

// ─────────────────────────────────────────────────────────────────────────
// Cliente de la TikTok Display API v2 — lectura de la cuenta PROPIA.
//
// LO QUE ESTA API PUEDE Y NO PUEDE: devuelve el perfil y los videos de la
// cuenta cuyo usuario autorizó la app (Login Kit). NO existe un equivalente a
// business_discovery: un competidor no se puede leer por acá. Para terceros
// la única vía legítima es un proveedor de datos; el scraping viola los
// términos de TikTok y queda fuera (documento al CTO, 2026-09-08).
//
// TOKENS: el access token dura 24 h; se renueva con el refresh token (365
// días), y TikTok PUEDE devolver un refresh token nuevo en cada renovación —
// el anterior deja de valer. Por eso el vigente se guarda en la BD
// (TiktokCredential) y la variable TIKTOK_REFRESH_TOKEN solo siembra la
// primera fila. Si un día el refresh vence (365 días sin usarse, o revocado),
// hay que repetir el Login Kit y cargar el nuevo en Railway.
//
// Convenciones de la API: los errores vienen en el cuerpo, con HTTP 200 a
// veces, como {error:{code:"ok"|"...", message, log_id}} — "ok" significa que
// no hubo error. Los contadores son int64 en JSON (números, no strings).
// ─────────────────────────────────────────────────────────────────────────

export class TiktokApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string | null = null, public readonly logId: string | null = null) {
    super(message);
    this.name = 'TiktokApiError';
  }
}

/** Traducción de los códigos de error documentados a un mensaje para el modelo. */
export function explicarErrorTiktok(code: string | null, mensaje: string): string {
  switch (code) {
    case 'access_token_invalid':
    case 'invalid_grant':
      return `El token de TikTok no sirve o expiró (${mensaje}). Si la renovación automática también falla, hay que repetir la autorización (Login Kit) y cargar el refresh token nuevo en Railway. NO reintentes: avisa al socio.`;
    case 'scope_not_authorized':
    case 'scope_permission_missed':
      return `A la autorización de TikTok le falta un permiso (${mensaje}). Hacen falta user.info.basic, user.info.profile, user.info.stats y video.list.`;
    case 'rate_limit_exceeded':
      return `TikTok limitó las llamadas por ahora (${mensaje}). NO reintentes de inmediato; dile al socio que en unos minutos se puede volver a consultar.`;
    case 'internal_error':
      return `TikTok respondió con un error interno (${mensaje}). Suele ser pasajero: informa al socio, no reintentes en bucle.`;
    default:
      return `TikTok respondió con un error${code ? ` (${code})` : ''}: ${mensaje}`;
  }
}

/**
 * Lo mínimo para intentar leer: la app (key + secret). El refresh token puede
 * venir de la variable o de la BD (autorización hecha desde la web); si no
 * hay ninguno, accessToken() lo dice al pedirlo.
 */
export function tiktokConfigurado(): boolean {
  return Boolean(config.tiktok.clientKey && config.tiktok.clientSecret);
}

// ── Tokens ────────────────────────────────────────────────────────────────

/** Margen para renovar antes de que venza: una llamada que arranca con 30 s de token y tarda 40 falla a la mitad. */
const MARGEN_MS = 5 * 60_000;

interface TokenRespuesta {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  error?: string;
  error_description?: string;
}

/**
 * Devuelve un access token vigente, renovándolo si hace falta. La fila de
 * credenciales se crea a partir de la variable la primera vez; a partir de ahí
 * el refresh token que manda es el de la BD, porque TikTok lo puede rotar.
 */
interface Cred {
  refreshToken: string;
  accessToken: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
  openId: string | null;
}

/**
 * Copia en memoria de la credencial. La BD es la fuente durable, pero si no
 * está (migración pendiente, tests sin Postgres) la lectura no puede depender
 * de ella: con el refresh rotando, perder el token nuevo por un fallo de BD
 * dejaría a Kaizen sin TikTok hasta repetir el Login Kit. Se avisa en el log.
 */
let memo: Cred | null = null;

const ultimaLinea = (m: string) => m.trim().split('\n').filter((l) => l.trim()).pop() ?? m;

async function leerCred(): Promise<Cred> {
  if (memo) return memo;
  try {
    const fila = await db.tiktokCredential.findUnique({ where: { id: 1 } });
    memo = fila ?? (await db.tiktokCredential.create({ data: { id: 1, refreshToken: config.tiktok.refreshToken } }));
  } catch (e) {
    console.warn('[tiktok] No se pudo leer TiktokCredential (¿migración pendiente?); se usa la variable de entorno:', e instanceof Error ? ultimaLinea(e.message) : e);
    memo = { refreshToken: config.tiktok.refreshToken, accessToken: null, accessExpiresAt: null, refreshExpiresAt: null, openId: null };
  }
  return memo;
}

async function guardarCred(c: Cred): Promise<void> {
  memo = c;
  try {
    await db.tiktokCredential.upsert({ where: { id: 1 }, create: { id: 1, ...c }, update: c });
  } catch (e) {
    console.warn('[tiktok] No se pudo guardar el token renovado en la BD; queda solo en memoria hasta el próximo reinicio:', e instanceof Error ? ultimaLinea(e.message) : e);
  }
}

export async function accessToken(): Promise<string> {
  if (!tiktokConfigurado()) {
    throw new TiktokApiError(0, 'Faltan TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET y/o TIKTOK_REFRESH_TOKEN. Kaizen no puede leer TikTok sin la autorización de la cuenta de FinZen.');
  }

  const cred = await leerCred();
  if (!cred.refreshToken) {
    throw new TiktokApiError(0, "TikTok todavía no está autorizado: falta que un socio conecte la cuenta de FinZen desde Marketing → Configuración (botón Conectar TikTok), o cargar TIKTOK_REFRESH_TOKEN. NO reintentes.");
  }
  if (cred.accessToken && cred.accessExpiresAt && cred.accessExpiresAt.getTime() - Date.now() > MARGEN_MS) {
    return cred.accessToken;
  }

  const body = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: cred.refreshToken,
  });
  const res = await fetch(`${config.tiktok.baseUrl}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as TokenRespuesta;
  if (!res.ok || json.error || !json.access_token) {
    throw new TiktokApiError(res.status, explicarErrorTiktok(json.error ?? null, json.error_description ?? `HTTP ${res.status}`), json.error ?? null);
  }

  const ahora = Date.now();
  await guardarCred({
    accessToken: json.access_token,
    accessExpiresAt: new Date(ahora + (json.expires_in ?? 86_400) * 1000),
    // Si vino uno nuevo, ES el nuevo; si no vino, se conserva el actual.
    refreshToken: json.refresh_token || cred.refreshToken,
    refreshExpiresAt: json.refresh_expires_in ? new Date(ahora + json.refresh_expires_in * 1000) : cred.refreshExpiresAt,
    openId: json.open_id ?? cred.openId,
  });
  return json.access_token;
}

// ── Transporte ────────────────────────────────────────────────────────────

interface Envoltura<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

async function request<T>(metodo: 'GET' | 'POST', path: string, params: Record<string, string> = {}, body?: Record<string, unknown>): Promise<T> {
  const token = await accessToken();
  const url = new URL(`${config.tiktok.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Envoltura<T>;
  const code = json.error?.code ?? null;
  // "ok" es el código de éxito de esta API; cualquier otro es error aunque el HTTP sea 200.
  if (!res.ok || (code && code !== 'ok')) {
    const mensaje = json.error?.message || `HTTP ${res.status}`;
    throw new TiktokApiError(res.status, explicarErrorTiktok(code, mensaje), code, json.error?.log_id ?? null);
  }
  if (!json.data) {
    throw new TiktokApiError(res.status, 'TikTok respondió sin datos. Suele ser un permiso que falta en la autorización (user.info.stats o video.list).');
  }
  return json.data;
}

// ── Tipos ─────────────────────────────────────────────────────────────────

export interface VideoTiktok {
  id: string;
  titulo: string;
  descripcion: string;
  view_count: number;
  like_count: number;
  comments_count: number;
  share_count: number;
  /** Segundos. */
  duracion: number;
  permalink: string;
  /** ISO 8601. */
  timestamp: string;
}

export interface PerfilTiktokLeido {
  usuario: string;
  nombre: string;
  biografia: string;
  url: string;
  verificada: boolean;
  seguidores: number;
  seguidos: number;
  likes_totales: number;
  videos_totales: number;
  /** Los últimos N, del más reciente al más viejo. */
  videos: VideoTiktok[];
  leido_en: string;
}

// ── Lectura ───────────────────────────────────────────────────────────────

const CAMPOS_USUARIO = 'open_id,display_name,username,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count';
const CAMPOS_VIDEO = 'id,title,video_description,create_time,share_url,duration,view_count,like_count,comment_count,share_count';
/** La API pagina de a 20 como máximo. */
const VIDEOS_POR_PAGINA = 20;
const VIDEOS_MAXIMO = 60;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Exportada para probarla sin red: un video sin título o sin contadores no debe romper el resumen. */
export function normalizarVideos(filas: Array<Record<string, unknown>>): VideoTiktok[] {
  return filas.map((v) => ({
    id: String(v.id ?? ''),
    titulo: String(v.title ?? ''),
    descripcion: String(v.video_description ?? ''),
    view_count: num(v.view_count),
    like_count: num(v.like_count),
    comments_count: num(v.comment_count),
    share_count: num(v.share_count),
    duracion: num(v.duration),
    permalink: String(v.share_url ?? ''),
    // create_time viene en segundos Unix.
    timestamp: v.create_time ? new Date(num(v.create_time) * 1000).toISOString() : '',
  }));
}

/**
 * Lee la cuenta propia: perfil + últimos N videos. `usuario` se usa solo para
 * verificar que la cuenta autorizada sea la que el socio guardó; la Display
 * API no acepta leer otra.
 */
export async function getPerfilPropio(cuantosVideos = VIDEOS_POR_PAGINA): Promise<PerfilTiktokLeido> {
  const limite = Math.max(1, Math.min(cuantosVideos, VIDEOS_MAXIMO));

  const u = await request<{ user: Record<string, unknown> }>('GET', '/user/info/', { fields: CAMPOS_USUARIO });
  const user = u.user ?? {};

  const videos: VideoTiktok[] = [];
  let cursor: number | undefined;
  while (videos.length < limite) {
    const pagina = await request<{ videos?: Array<Record<string, unknown>>; cursor?: number; has_more?: boolean }>(
      'POST',
      '/video/list/',
      { fields: CAMPOS_VIDEO },
      { max_count: Math.min(VIDEOS_POR_PAGINA, limite - videos.length), ...(cursor ? { cursor } : {}) },
    );
    videos.push(...normalizarVideos(pagina.videos ?? []));
    if (!pagina.has_more || !pagina.cursor) break;
    cursor = pagina.cursor;
  }

  const usuario = String(user.username ?? '').toLowerCase();
  return {
    usuario,
    nombre: String(user.display_name ?? ''),
    biografia: String(user.bio_description ?? ''),
    url: String(user.profile_deep_link ?? (usuario ? `https://www.tiktok.com/@${usuario}` : '')),
    verificada: Boolean(user.is_verified),
    seguidores: num(user.follower_count),
    seguidos: num(user.following_count),
    likes_totales: num(user.likes_count),
    videos_totales: num(user.video_count),
    videos: videos.slice(0, limite),
    leido_en: new Date().toISOString(),
  };
}

// ── Autorización (Login Kit) ──────────────────────────────────────────────
//
// La autorización se hace UNA vez, desde Marketing → Configuración: Kaizen
// manda a TikTok, TikTok vuelve con un code, y acá se cambia por el par de
// tokens que queda en TiktokCredential. Así nadie tiene que hacer el
// intercambio a mano ni pegar un refresh token en Railway.

export const SCOPES_TIKTOK = ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"] as const;

/** La URL de autorización de TikTok para la cuenta de FinZen. */
export function urlAutorizacion(redirectUri: string, state: string): string {
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.searchParams.set("client_key", config.tiktok.clientKey);
  u.searchParams.set("scope", SCOPES_TIKTOK.join(","));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

/** Cambia el code del callback por tokens y los deja guardados. Devuelve el usuario autorizado. */
export async function canjearCodigo(code: string, redirectUri: string): Promise<{ openId: string | null; scope: string }> {
  if (!config.tiktok.clientKey || !config.tiktok.clientSecret) {
    throw new TiktokApiError(0, "Faltan TIKTOK_CLIENT_KEY y/o TIKTOK_CLIENT_SECRET: sin ellos no se puede canjear la autorización.");
  }
  const body = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${config.tiktok.baseUrl}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as TokenRespuesta & { scope?: string };
  if (!res.ok || json.error || !json.access_token || !json.refresh_token) {
    throw new TiktokApiError(res.status, explicarErrorTiktok(json.error ?? null, json.error_description ?? `HTTP ${res.status}`), json.error ?? null);
  }
  const ahora = Date.now();
  await guardarCred({
    accessToken: json.access_token,
    accessExpiresAt: new Date(ahora + (json.expires_in ?? 86_400) * 1000),
    refreshToken: json.refresh_token,
    refreshExpiresAt: json.refresh_expires_in ? new Date(ahora + json.refresh_expires_in * 1000) : null,
    openId: json.open_id ?? null,
  });
  return { openId: json.open_id ?? null, scope: json.scope ?? "" };
}

/** ¿Hay una credencial usable (variable o BD)? Y hasta cuándo dura el refresh, si se sabe. */
export async function estadoCredencial(): Promise<{ conectada: boolean; fuente: "bd" | "variable" | null; refreshVenceEn: string | null; openId: string | null }> {
  if (!config.tiktok.clientKey || !config.tiktok.clientSecret) return { conectada: false, fuente: null, refreshVenceEn: null, openId: null };
  try {
    const fila = await db.tiktokCredential.findUnique({ where: { id: 1 } });
    if (fila?.refreshToken) return { conectada: true, fuente: "bd", refreshVenceEn: fila.refreshExpiresAt?.toISOString() ?? null, openId: fila.openId };
  } catch {
    /* sin BD: cae a la variable */
  }
  if (config.tiktok.refreshToken) return { conectada: true, fuente: "variable", refreshVenceEn: null, openId: null };
  return { conectada: false, fuente: null, refreshVenceEn: null, openId: null };
}

/** Solo para tests. */
export function olvidarCredencialTiktok(): void {
  memo = null;
}
