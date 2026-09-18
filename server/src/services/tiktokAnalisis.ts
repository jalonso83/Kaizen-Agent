import { Prisma } from '@prisma/client';
import { db } from '../db';
import { todayInRD } from '../util/fecha';
import { getPerfilPropio, tiktokConfigurado, type VideoTiktok } from '../clients/tiktokApi';
import { armarHistorico, mediana, redondear, type CuentaGuardada, type Historico, type PuntoHistorico } from './instagramAnalisis';

// ─────────────────────────────────────────────────────────────────────────
// Análisis de la cuenta de TikTok — lo que comparten la tool del agente
// (get_tiktok_profile) y el Dashboard. Espejo de instagramAnalisis.ts, con
// las métricas que TikTok sí da y que importan en video corto:
//
//   Perfil: seguidores, seguidos, likes totales de la cuenta, videos totales.
//   Por video: views, likes, comentarios, compartidos, duración.
//   Calculado acá: interacciones (likes + comentarios + compartidos),
//     MEDIANA de views (en TikTok un video viral distorsiona todo), tasa de
//     engagement sobre VIEWS (interacciones / views — en video corto la base
//     es quien lo vio, no quien sigue: la distribución es por For You),
//     tasa sobre seguidores (para comparar con Instagram), ritmo, top 3.
//
// Solo la cuenta propia: la Display API no lee terceros. Una cuenta guardada
// con red TIKTOK y esPropia=false no se puede analizar, y la tool lo dice.
// ─────────────────────────────────────────────────────────────────────────

export interface ResumenVideos {
  cantidad: number;
  views_total: number;
  views_promedio: number;
  /** En TikTok la mediana de views es el número honesto: un viral en la muestra multiplica el promedio. */
  views_mediana: number;
  likes_promedio: number;
  comentarios_promedio: number;
  compartidos_promedio: number;
  interacciones_promedio: number;
  /** Segundos. */
  duracion_promedio: number;
  top: Array<{ permalink: string; views: number; likes: number; comentarios: number; compartidos: number; fecha: string; titulo: string }>;
  desde: string | null;
  hasta: string | null;
  videos_por_semana: number | null;
}

export interface AnalisisTiktok {
  cuenta: { usuario: string; url: string; etiqueta: string | null; es_de_finzen: boolean };
  perfil: { nombre: string; biografia: string; verificada: boolean; seguidores: number; seguidos: number; likes_totales: number; videos_totales: number };
  /** interacciones promedio por video / views promedio × 100. La definición natural de TikTok. */
  tasa_engagement_views_pct: number | null;
  /** interacciones promedio por video / seguidores × 100. Solo para comparar con Instagram. */
  tasa_engagement_pct: number | null;
  resumen_videos: ResumenVideos;
  videos: VideoTiktok[];
  historico: Historico;
  leido_en: string;
  desde_cache: boolean;
}

const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const inter = (v: VideoTiktok) => v.like_count + v.comments_count + v.share_count;

export function resumirVideos(videos: VideoTiktok[]): ResumenVideos {
  if (videos.length === 0) {
    return {
      cantidad: 0, views_total: 0, views_promedio: 0, views_mediana: 0, likes_promedio: 0, comentarios_promedio: 0,
      compartidos_promedio: 0, interacciones_promedio: 0, duracion_promedio: 0, top: [], desde: null, hasta: null, videos_por_semana: null,
    };
  }
  const n = videos.length;
  const views = videos.map((v) => v.view_count);
  const top = [...videos]
    .sort((a, b) => b.view_count - a.view_count)
    .slice(0, 3)
    .map((v) => ({
      permalink: v.permalink,
      views: v.view_count,
      likes: v.like_count,
      comentarios: v.comments_count,
      compartidos: v.share_count,
      fecha: v.timestamp.slice(0, 10),
      titulo: (v.titulo || v.descripcion).replace(/\s+/g, ' ').trim().slice(0, 80),
    }));
  const fechas = videos.map((v) => v.timestamp).filter(Boolean).sort();
  let videos_por_semana: number | null = null;
  if (fechas.length >= 2) {
    const dias = (Date.parse(fechas[fechas.length - 1]) - Date.parse(fechas[0])) / 86_400_000;
    if (dias >= 1) videos_por_semana = redondear((n / dias) * 7);
  }
  return {
    cantidad: n,
    views_total: suma(views),
    views_promedio: redondear(suma(views) / n),
    views_mediana: mediana(views),
    likes_promedio: redondear(suma(videos.map((v) => v.like_count)) / n),
    comentarios_promedio: redondear(suma(videos.map((v) => v.comments_count)) / n),
    compartidos_promedio: redondear(suma(videos.map((v) => v.share_count)) / n),
    interacciones_promedio: redondear(suma(videos.map(inter)) / n),
    duracion_promedio: redondear(suma(videos.map((v) => v.duracion)) / n),
    top,
    desde: fechas[0]?.slice(0, 10) ?? null,
    hasta: fechas[fechas.length - 1]?.slice(0, 10) ?? null,
    videos_por_semana,
  };
}

// ── Cuentas guardadas ─────────────────────────────────────────────────────

export async function cuentasTiktokGuardadas(): Promise<CuentaGuardada[]> {
  try {
    return await db.marketingAccount.findMany({
      where: { red: 'TIKTOK' },
      select: { usuario: true, url: true, etiqueta: true, esPropia: true },
      orderBy: [{ esPropia: 'desc' }, { createdAt: 'asc' }],
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') {
      throw new Error('La tabla de cuentas de marketing no existe todavía en esta base de datos. NO reintentes: dile al socio que quien administra Railway tiene que correr `prisma migrate deploy`.');
    }
    throw e;
  }
}

export function faltaConfiguracionTiktok(): string | null {
  if (tiktokConfigurado()) return null;
  return 'La lectura de TikTok todavía no está configurada (faltan TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET y/o TIKTOK_REFRESH_TOKEN). NO reintentes: la autorización de la cuenta de FinZen la hace FinZen y las variables se cargan en Railway.';
}

// ── Histórico ─────────────────────────────────────────────────────────────

function resumenError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.trim().split('\n').filter((l) => l.trim()).pop() ?? m;
}

async function guardarSnapshot(a: AnalisisTiktok): Promise<void> {
  const fecha = new Date(`${todayInRD(new Date(a.leido_en))}T00:00:00.000Z`);
  const datos = {
    leidoEn: new Date(a.leido_en),
    seguidores: a.perfil.seguidores,
    seguidos: a.perfil.seguidos,
    likesTotales: a.perfil.likes_totales,
    videosTotales: a.perfil.videos_totales,
    viewsMediana: a.resumen_videos.views_mediana,
    interaccionesPromedio: a.resumen_videos.interacciones_promedio,
    tasaEngagementPct: a.tasa_engagement_pct,
  };
  try {
    await db.tiktokSnapshot.upsert({
      where: { usuario_fecha: { usuario: a.cuenta.usuario, fecha } },
      create: { usuario: a.cuenta.usuario, fecha, ...datos },
      update: datos,
    });
  } catch (e) {
    console.warn(`[tiktok-snapshot] No se pudo guardar la lectura de @${a.cuenta.usuario}:`, resumenError(e));
  }
}

const HISTORICO_DIAS = 90;

async function historicoTiktok(usuario: string): Promise<Historico> {
  try {
    const desde = new Date(Date.now() - HISTORICO_DIAS * 86_400_000);
    const [filas, primera] = await Promise.all([
      db.tiktokSnapshot.findMany({ where: { usuario, fecha: { gte: desde } }, orderBy: { fecha: 'asc' } }),
      db.tiktokSnapshot.findFirst({ where: { usuario }, orderBy: { fecha: 'asc' }, select: { fecha: true } }),
    ]);
    // Mismo tipo de punto que Instagram para que los deltas se calculen igual:
    // "publicaciones" son videos y "likes_mediana" es la mediana de likes por
    // video (no de views: esa va aparte en la tabla).
    const puntos: PuntoHistorico[] = filas.map((f) => ({
      fecha: f.fecha.toISOString().slice(0, 10),
      seguidores: f.seguidores,
      seguidos: f.seguidos,
      publicaciones_totales: f.videosTotales,
      interacciones_promedio: f.interaccionesPromedio,
      likes_mediana: f.viewsMediana,
      tasa_engagement_pct: f.tasaEngagementPct,
    }));
    return armarHistorico(puntos, primera?.fecha.toISOString().slice(0, 10) ?? null, HISTORICO_DIAS);
  } catch (e) {
    console.warn(`[tiktok-snapshot] No se pudo leer el histórico de @${usuario}:`, resumenError(e));
    return armarHistorico([], null, HISTORICO_DIAS);
  }
}

// ── Lectura + caché ───────────────────────────────────────────────────────

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { hasta: number; analisis: AnalisisTiktok }>();
export const VIDEOS_POR_DEFECTO = 20;
export const VIDEOS_MAXIMO = 60;

export async function analizarTiktok(cuenta: CuentaGuardada, opts: { videos?: number; forzar?: boolean } = {}): Promise<AnalisisTiktok> {
  if (!cuenta.esPropia) {
    throw new Error(
      `@${cuenta.usuario} es un tercero, y TikTok solo permite leer la cuenta que autorizó la app (la de FinZen). ` +
        'No hay forma oficial de leer perfiles ajenos: para competidores hace falta un proveedor de datos, que todavía no está decidido. Dilo así, no lo estimes.',
    );
  }
  const cuantos = Math.min(Math.max(Number(opts.videos) || VIDEOS_POR_DEFECTO, 1), VIDEOS_MAXIMO);
  const clave = `${cuenta.usuario}:${cuantos}`;
  const hit = cache.get(clave);
  if (hit && hit.hasta > Date.now() && !opts.forzar) return { ...hit.analisis, desde_cache: true };

  const perfil = await getPerfilPropio(cuantos);
  if (perfil.usuario && perfil.usuario !== cuenta.usuario) {
    throw new Error(
      `La cuenta de TikTok que autorizó a Kaizen es @${perfil.usuario}, pero en Marketing → Configuración la de FinZen está guardada como @${cuenta.usuario}. ` +
        'Alguna de las dos está mal: dile al socio que revise cuál es la correcta.',
    );
  }
  const resumen = resumirVideos(perfil.videos);
  const analisis: AnalisisTiktok = {
    cuenta: { usuario: cuenta.usuario, url: cuenta.url, etiqueta: cuenta.etiqueta, es_de_finzen: true },
    perfil: {
      nombre: perfil.nombre, biografia: perfil.biografia, verificada: perfil.verificada,
      seguidores: perfil.seguidores, seguidos: perfil.seguidos, likes_totales: perfil.likes_totales, videos_totales: perfil.videos_totales,
    },
    tasa_engagement_views_pct: resumen.views_promedio > 0 ? redondear((resumen.interacciones_promedio / resumen.views_promedio) * 100, 2) : null,
    tasa_engagement_pct: perfil.seguidores > 0 && resumen.cantidad > 0 ? redondear((resumen.interacciones_promedio / perfil.seguidores) * 100, 2) : null,
    resumen_videos: resumen,
    videos: perfil.videos,
    historico: armarHistorico([], null, HISTORICO_DIAS),
    leido_en: perfil.leido_en,
    desde_cache: false,
  };
  await guardarSnapshot(analisis);
  analisis.historico = await historicoTiktok(cuenta.usuario);
  cache.set(clave, { hasta: Date.now() + TTL_MS, analisis });
  return analisis;
}

export function vaciarCacheTiktok(): void {
  cache.clear();
}
