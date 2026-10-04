import { config } from '../config';
import { GraphApiError, graphRequest } from './graphApi';

/**
 * El error de Graph, con el nombre con el que ya se lo conoce en este módulo.
 * Es la MISMA clase que usa el cliente de Instagram, así que un
 * `instanceof MetaApiError` sigue funcionando igual que antes.
 */
export { GraphApiError as MetaApiError };

// ─────────────────────────────────────────────────────────────────────────
// Cliente de la Meta Marketing API (Graph API) — Fase 2, PRD §2.1/§2.2.
//
// El transporte (auth, timeout, traducción de errores) vive en graphApi.ts,
// compartido con el cliente de Instagram: es la misma API y el mismo token.
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

/** `act_123` venga como venga: el PRD lo escribe con prefijo, la UI de Meta a veces no. */
function cuenta(): string {
  const id = config.meta.adAccountId;
  if (!id) {
    throw new GraphApiError(0, 'Falta META_AD_ACCOUNT_ID. Sin cuenta publicitaria no hay nada que leer.');
  }
  return id.startsWith('act_') ? id : `act_${id}`;
}

const request = graphRequest;

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
    throw new GraphApiError(
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
    throw new GraphApiError(
      0,
      `La cuenta de Meta factura en ${moneda} y el tope está definido en USD (META_MAX_DAILY_BUDGET_USD). ` +
        'No se aplica una conversión automática: hay que definir el tope en la moneda de la cuenta antes de poder crear nada.',
    );
  }
  if (!Number.isFinite(dailyBudgetUsd) || dailyBudgetUsd <= 0) {
    throw new GraphApiError(0, 'El presupuesto diario tiene que ser un número mayor que cero.');
  }
  if (dailyBudgetUsd > tope) {
    throw new GraphApiError(
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
  /**
   * Categoría especial "productos y servicios financieros". Si se declara,
   * Meta exige los países donde corre y limita la segmentación. Viene de la
   * configuración, no del modelo.
   */
  categoriaFinanciera?: { paises: string[] };
}

/**
 * Crea una campaña en Meta EN PAUSA.
 *
 * Fíjate en lo que NO recibe: `status`. No es un descuido — es el guardarraíl.
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
    throw new GraphApiError(
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
    // Con presupuesto en la campaña (un solo conjunto adentro), la estrategia
    // de puja va acá. "Menor costo sin tope" es la de Meta por defecto.
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    special_ad_categories: input.categoriaFinanciera ? ['FINANCIAL_PRODUCTS_SERVICES'] : [],
    ...(input.categoriaFinanciera ? { special_ad_category_country: input.categoriaFinanciera.paises } : {}),
  });
}

// ── Anuncio completo que promociona un post de Instagram (2026-10-04) ─────
//
// Una campaña de Meta no es un objeto sino cuatro: campaña (objetivo y
// presupuesto), conjunto de anuncios (a quién, cuándo, qué optimiza),
// creativo (qué se ve: acá, un post de Instagram ya publicado) y anuncio
// (el que une conjunto y creativo). Los cuatro nacen EN PAUSA, y ninguna de
// estas funciones recibe `status`: es el mismo guardarraíl que
// createCampaignDraft, extendido a toda la cadena.
//
// Si un paso falla, los anteriores YA EXISTEN en Meta (en pausa: no gastan).
// No se intenta deshacer: borrar en Meta es otra escritura que puede fallar
// a su vez, y un humano en Ads Manager lo resuelve mejor. Lo que sí se hace
// es avisar cada id apenas existe (alAvanzar), para que quede en la BD aunque
// el paso siguiente reviente.

export const OBJETIVOS_ANUNCIO = ['OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_AWARENESS'] as const;
export type ObjetivoAnuncio = (typeof OBJETIVOS_ANUNCIO)[number];

/** Qué optimiza el conjunto según el objetivo. Una combinación inválida Meta la rechaza con (#100). */
const OPTIMIZACION: Record<ObjetivoAnuncio, { optimization_goal: string; destination_type?: string }> = {
  OUTCOME_TRAFFIC: { optimization_goal: 'LINK_CLICKS', destination_type: 'WEBSITE' },
  OUTCOME_ENGAGEMENT: { optimization_goal: 'POST_ENGAGEMENT', destination_type: 'ON_POST' },
  OUTCOME_AWARENESS: { optimization_goal: 'REACH' },
};

export interface AnuncioIgInput {
  /** kaizen-ig-AAAAMMDD-slug: también es el utm_campaign. */
  nombre: string;
  objetivo: ObjetivoAnuncio;
  presupuestoDiarioUsd: number;
  inicio: Date;
  fin: Date;
  paises: string[];
  edadMin: number;
  edadMax: number;
  categoriaFinanciera: boolean;
  /** Id del post de Instagram de FinZen (verificado antes contra la cuenta propia). */
  mediaId: string;
  /** Con los UTM ya puestos. Obligatorio con OUTCOME_TRAFFIC; ignorado en los demás. */
  urlDestino: string | null;
}

export interface IdsAnuncio {
  campaignId?: string;
  adSetId?: string;
  creativeId?: string;
  adId?: string;
}

/**
 * Crea campaña + conjunto + creativo + anuncio, TODO EN PAUSA. Devuelve los
 * cuatro ids. `alAvanzar` se llama con lo acumulado después de cada paso.
 */
export async function crearAnuncioIgEnPausa(
  input: AnuncioIgInput,
  alAvanzar: (ids: IdsAnuncio) => Promise<void> = async () => {},
): Promise<Required<IdsAnuncio>> {
  assertWriteEnabled();
  if (!config.meta.pageId) {
    throw new GraphApiError(0, 'Falta META_PAGE_ID (la página de Facebook vinculada al Instagram de FinZen). Meta la exige para promocionar un post de Instagram.');
  }
  if (!config.instagram.accountId) {
    throw new GraphApiError(0, 'Falta INSTAGRAM_ACCOUNT_ID. Sin la cuenta de Instagram no se puede promocionar un post.');
  }
  if (!(OBJETIVOS_ANUNCIO as readonly string[]).includes(input.objetivo)) {
    throw new GraphApiError(0, `Objetivo no permitido: ${input.objetivo}.`);
  }
  if (input.objetivo === 'OUTCOME_TRAFFIC' && !input.urlDestino) {
    throw new GraphApiError(0, 'Con el objetivo de tráfico hace falta una URL de destino.');
  }
  if (!(input.fin > input.inicio)) {
    throw new GraphApiError(0, 'La fecha de fin tiene que ser posterior a la de inicio.');
  }

  const ids: IdsAnuncio = {};

  // 1. Campaña (valida cuenta activa, moneda y tope antes de salir).
  const campana = await createCampaignDraft({
    name: input.nombre,
    objective: input.objetivo,
    dailyBudgetUsd: input.presupuestoDiarioUsd,
    ...(input.categoriaFinanciera ? { categoriaFinanciera: { paises: input.paises } } : {}),
  });
  ids.campaignId = campana.id;
  await alAvanzar({ ...ids });

  // 2. Conjunto: a quién, cuándo, qué optimiza. Solo Instagram, porque el
  //    creativo es un post de Instagram. Advantage+ audience apagado: la
  //    edad y los países configurados se respetan tal cual.
  const conjunto = await request<{ id: string }>('POST', `/${cuenta()}/adsets`, {}, {
    name: `${input.nombre} · conjunto`,
    campaign_id: campana.id,
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    ...OPTIMIZACION[input.objetivo],
    start_time: input.inicio.toISOString(),
    end_time: input.fin.toISOString(),
    targeting: {
      geo_locations: { countries: input.paises },
      age_min: input.edadMin,
      age_max: input.edadMax,
      publisher_platforms: ['instagram'],
      targeting_automation: { advantage_audience: 0 },
    },
  });
  ids.adSetId = conjunto.id;
  await alAvanzar({ ...ids });

  // 3. Creativo: el post tal cual, con sus likes y comentarios.
  const creativo = await request<{ id: string }>('POST', `/${cuenta()}/adcreatives`, {}, {
    name: `${input.nombre} · creativo`,
    object_id: config.meta.pageId,
    instagram_user_id: config.instagram.accountId,
    source_instagram_media_id: input.mediaId,
    ...(input.objetivo === 'OUTCOME_TRAFFIC' && input.urlDestino
      ? { call_to_action: { type: 'LEARN_MORE', value: { link: input.urlDestino } } }
      : {}),
  });
  ids.creativeId = creativo.id;
  await alAvanzar({ ...ids });

  // 4. Anuncio.
  const anuncio = await request<{ id: string }>('POST', `/${cuenta()}/ads`, {}, {
    name: `${input.nombre} · anuncio`,
    adset_id: conjunto.id,
    creative: { creative_id: creativo.id },
    status: 'PAUSED',
  });
  ids.adId = anuncio.id;
  await alAvanzar({ ...ids });

  return ids as Required<IdsAnuncio>;
}

/** Link directo a la campaña en Ads Manager, para el humano que la activa. */
export function urlAdsManager(campaignId: string): string {
  const act = config.meta.adAccountId.replace(/^act_/, '');
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${campaignId}`;
}
