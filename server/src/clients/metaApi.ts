import { config } from '../config';

// ─────────────────────────────────────────────────────────────────────────
// Cliente de la Meta Marketing API (Graph API) — Fase 2, PRD §2.1/§2.2.
//
// La diferencia con clients/finzenApi.ts es que acá hay DINERO REAL del otro
// lado. Eso cambia tres cosas del diseño, y las tres son estructurales:
//
//  1. LEER Y ESCRIBIR SON DOS PERMISOS DISTINTOS. El PRD manda `ads_read`
//     primero y `ads_management` recién cuando la lectura lleve ≥1 semana
//     estable. Acá eso no es una nota en un doc: `assertWriteEnabled()` tumba
//     cualquier escritura mientras META_WRITE_ENABLED no esté en true.
//
//  2. NINGUNA FUNCIÓN DE ESTE ARCHIVO PUEDE ACTIVAR UNA CAMPAÑA. No es que
//     "no se deba": createCampaignDraft no recibe `status` como parámetro y lo
//     fija en 'PAUSED'. No hay argumento que el modelo pueda pasar para
//     cambiarlo, igual que create_campaign_draft de Fase 1 no recibe título ni
//     mensaje. Des-pausar es manual, un humano en Ads Manager.
//
//  3. EL TOPE DE PRESUPUESTO SE VALIDA ANTES DE SALIR. Y se valida contra la
//     moneda real de la cuenta, no asumiendo dólares — ver assertBudget.
//
// El token va en el header Authorization y NUNCA en la query string: los
// access tokens en URLs terminan en logs de proxies, en el historial y en
// cualquier herramienta que registre la URL completa.
// ─────────────────────────────────────────────────────────────────────────

const API_VERSION = 'v21.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

export class MetaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Código de error de Graph (no HTTP). 190 = token, 4/17/80004 = rate limit. */
    public readonly code: number | null = null,
    /** Identificador que Meta pide para reportar un problema en su soporte. */
    public readonly fbtraceId: string | null = null,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

/** Traduce los códigos de Graph que hay que saber distinguir al operar. */
function explicar(code: number | null, mensaje: string): string {
  switch (code) {
    case 190:
      return `El token de Meta no sirve o expiró (${mensaje}). Hay que regenerar META_SYSTEM_TOKEN.`;
    case 200:
    case 294:
      return `El token no tiene permiso para esta operación (${mensaje}). Revisar que tenga ads_read, y ads_management si es escritura.`;
    case 4:
    case 17:
    case 80004:
      return `Meta está limitando por volumen de llamadas (${mensaje}). No reintentar en bucle: esperar.`;
    case 100:
      return `Meta rechazó los parámetros (${mensaje}). Suele ser un campo mal escrito o un id de cuenta que no existe.`;
    default:
      return mensaje;
  }
}

/** `act_123` venga como venga: el PRD lo escribe con prefijo, la UI de Meta a veces no. */
function cuenta(): string {
  const id = config.meta.adAccountId;
  if (!id) {
    throw new MetaApiError(0, 'Falta META_AD_ACCOUNT_ID. Sin cuenta publicitaria no hay nada que leer.');
  }
  return id.startsWith('act_') ? id : `act_${id}`;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string> = {},
  body?: Record<string, unknown>,
): Promise<T> {
  if (!config.meta.systemToken) {
    throw new MetaApiError(0, 'Falta META_SYSTEM_TOKEN. Kaizen no puede hablar con Meta sin credencial.');
  }

  const url = new URL(`${config.meta.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.meta.systemToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
  };

  if (!res.ok || json.error) {
    const e = json.error ?? {};
    const code = typeof e.code === 'number' ? e.code : null;
    const crudo = e.message ?? `Meta API error ${res.status}`;
    throw new MetaApiError(res.status, explicar(code, crudo), code, e.fbtrace_id ?? null);
  }

  return json as T;
}

// ── Tipos ─────────────────────────────────────────────────────────────────

export interface MetaAccount {
  id: string;
  name: string;
  /** ISO 4217. NO se asume USD: el tope se valida contra esto (ver assertBudget). */
  currency: string;
  /** 1 = activa. Cualquier otro valor significa que no se puede gastar. */
  account_status: number;
  timezone_name: string;
}

export interface MetaCampaign {
  id: string;
  name: string;
  /** Lo que se pidió: ACTIVE | PAUSED | DELETED | ARCHIVED. */
  status: string;
  /** Lo que Meta realmente aplica (puede ser PAUSED por la cuenta o el adset). */
  effective_status: string;
  objective: string | null;
  /** Presupuesto en UNIDADES MENORES de la moneda de la cuenta (centavos). */
  daily_budget: number | null;
  lifetime_budget: number | null;
  created_time: string;
  start_time: string | null;
  stop_time: string | null;
}

export interface MetaSpendRow {
  campaign_id: string;
  campaign_name: string;
  /** En unidades ENTERAS de la moneda de la cuenta (Meta lo manda como string). */
  spend: number;
  impressions: number;
  clicks: number;
  cpm: number;
  cpc: number;
  ctr: number;
  date_start: string;
  date_stop: string;
}

// ── Lectura (ads_read) ────────────────────────────────────────────────────

/** Metadatos de la cuenta. Necesarios ANTES de cualquier tope: dan la moneda. */
export function getAccount(): Promise<MetaAccount> {
  return request<MetaAccount>('GET', `/${cuenta()}`, {
    fields: 'id,name,currency,account_status,timezone_name',
  });
}

const CAMPOS_CAMPANA =
  'id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,start_time,stop_time';

/**
 * Campañas de la cuenta. Pagina hasta agotar, con tope duro de páginas: una
 * cuenta con miles de campañas no puede colgar un turno del agente.
 */
export async function getCampaigns(limite = 100): Promise<MetaCampaign[]> {
  interface Pagina {
    data: Array<Record<string, unknown>>;
    paging?: { cursors?: { after?: string }; next?: string };
  }

  const todas: MetaCampaign[] = [];
  let after: string | undefined;

  for (let pagina = 0; pagina < 10; pagina++) {
    const r = await request<Pagina>('GET', `/${cuenta()}/campaigns`, {
      fields: CAMPOS_CAMPANA,
      limit: String(Math.min(limite, 100)),
      ...(after ? { after } : {}),
    });

    for (const c of r.data ?? []) {
      todas.push({
        id: String(c.id),
        name: String(c.name ?? ''),
        status: String(c.status ?? ''),
        effective_status: String(c.effective_status ?? ''),
        objective: c.objective ? String(c.objective) : null,
        // Meta manda los presupuestos como string y en unidades menores.
        daily_budget: c.daily_budget != null ? Number(c.daily_budget) : null,
        lifetime_budget: c.lifetime_budget != null ? Number(c.lifetime_budget) : null,
        created_time: String(c.created_time ?? ''),
        start_time: c.start_time ? String(c.start_time) : null,
        stop_time: c.stop_time ? String(c.stop_time) : null,
      });
    }

    after = r.paging?.cursors?.after;
    if (!after || !r.paging?.next || todas.length >= limite) break;
  }

  return todas.slice(0, limite);
}

/**
 * Gasto y rendimiento por campaña en una ventana de fechas.
 *
 * `since`/`until` son días inclusivos en la zona horaria DE LA CUENTA, no en
 * la de Kaizen. Es la fuente de discrepancias más común al cruzar con FinZen:
 * si la cuenta está en otra zona, el "ayer" de Meta no es el mismo día.
 */
export async function getSpend(since: string, until: string): Promise<MetaSpendRow[]> {
  interface Pagina { data: Array<Record<string, unknown>> }

  const r = await request<Pagina>('GET', `/${cuenta()}/insights`, {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,cpm,cpc,ctr',
    time_range: JSON.stringify({ since, until }),
    limit: '100',
  });

  // Graph devuelve TODAS las métricas numéricas como string. Number() sobre
  // undefined da NaN, que se propaga silencioso hasta un reporte que dice
  // "CAC: NaN" — por eso el ?? 0 explícito en cada campo.
  const num = (v: unknown) => (v == null ? 0 : Number(v));

  return (r.data ?? []).map((row) => ({
    campaign_id: String(row.campaign_id ?? ''),
    campaign_name: String(row.campaign_name ?? ''),
    spend: num(row.spend),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    cpm: num(row.cpm),
    cpc: num(row.cpc),
    ctr: num(row.ctr),
    date_start: String(row.date_start ?? since),
    date_stop: String(row.date_stop ?? until),
  }));
}

// ── Escritura (ads_management) — todavía apagada por defecto ──────────────

/**
 * Corta cualquier escritura mientras no se habilite explícitamente.
 *
 * El PRD manda `ads_read` primero y `ads_management` recién tras ≥1 semana
 * estable. Esto lo hace cumplible: aunque el token ya tuviera permiso de
 * escritura, sin META_WRITE_ENABLED=true no sale ni un POST.
 */
function assertWriteEnabled(): void {
  if (!config.meta.writeEnabled) {
    throw new MetaApiError(
      0,
      'La escritura en Meta está deshabilitada (META_WRITE_ENABLED). Fase 2 arranca en solo lectura: ' +
        'primero ≥1 semana de lecturas estables, después se habilita crear borradores.',
    );
  }
}

/**
 * Valida el presupuesto contra el tope, en la moneda real de la cuenta.
 *
 * Por qué no alcanza con comparar números: META_MAX_DAILY_BUDGET_USD está en
 * dólares. Si la cuenta factura en otra moneda, comparar 1500 DOP contra un
 * tope de 50 "USD" lo dejaría pasar por ser un número mayor y menor a la vez
 * según cómo se mire. Antes que convertir con un tipo de cambio inventado,
 * esto RECHAZA: es preferible que alguien tenga que definir el tope en la
 * moneda correcta a que Kaizen gaste con una conversión que nadie revisó.
 */
export function assertBudget(dailyBudgetUsd: number, moneda: string): void {
  const tope = config.meta.maxDailyBudgetUsd;

  if (moneda !== 'USD') {
    throw new MetaApiError(
      0,
      `La cuenta de Meta factura en ${moneda} y el tope está definido en USD (META_MAX_DAILY_BUDGET_USD). ` +
        'No se aplica una conversión automática: hay que definir el tope en la moneda de la cuenta antes de poder crear nada.',
    );
  }
  if (!Number.isFinite(dailyBudgetUsd) || dailyBudgetUsd <= 0) {
    throw new MetaApiError(0, 'El presupuesto diario tiene que ser un número mayor que cero.');
  }
  if (dailyBudgetUsd > tope) {
    throw new MetaApiError(
      0,
      `El presupuesto diario pedido (${dailyBudgetUsd} ${moneda}) supera el tope configurado de ${tope} ${moneda}. ` +
        'El tope no se negocia por chat: se cambia en META_MAX_DAILY_BUDGET_USD.',
    );
  }
}

export interface MetaCampaignDraftInput {
  name: string;
  objective: string;
  dailyBudgetUsd: number;
}

/**
 * Crea una campaña en Meta EN PAUSA.
 *
 * Fijate en lo que NO recibe: `status`. No es un descuido — es el guardarraíl.
 * El criterio de aceptación de Fase 2 dice "es imposible (probado) que el
 * agente active una campaña", y la forma de hacerlo imposible no es pedirle al
 * modelo que mande siempre PAUSED, es no darle dónde escribirlo. Mismo patrón
 * que create_campaign_draft de Fase 1, que solo recibe un proposal_id.
 */
export async function createCampaignDraft(input: MetaCampaignDraftInput): Promise<{ id: string }> {
  assertWriteEnabled();

  // La moneda sale de la cuenta en cada llamada, no de una caché ni de una
  // suposición: es el dato del que depende que el tope signifique algo.
  const account = await getAccount();
  assertBudget(input.dailyBudgetUsd, account.currency);

  if (account.account_status !== 1) {
    throw new MetaApiError(
      0,
      `La cuenta de Meta no está activa (account_status=${account.account_status}). No se crea nada sobre una cuenta en ese estado.`,
    );
  }

  return request<{ id: string }>('POST', `/${cuenta()}/campaigns`, {}, {
    name: input.name,
    objective: input.objective,
    // Unidades menores: Meta espera centavos. 50 USD => 5000.
    daily_budget: Math.round(input.dailyBudgetUsd * 100),
    status: 'PAUSED',
    special_ad_categories: [],
  });
}
