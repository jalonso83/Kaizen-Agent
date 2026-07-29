import { config } from '../config';

// ─────────────────────────────────────────────────────────────────────────
// Cliente de la FinZen Agent API — el ÚNICO puente entre Kaizen y FinZen.
// Contratos definitivos en el PRD §4. Auth por header x-agent-key.
//
// Respuestas de error a manejar:
//  - 401: key inválida → revisar FINZEN_AGENT_KEY
//  - 503: Agent API deshabilitada (FinZen no ha puesto AGENT_API_KEY / kill switch)
//  - 429: límite de borradores diarios alcanzado → avisar al socio, no reintentar
// ─────────────────────────────────────────────────────────────────────────

export class FinzenApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'FinzenApiError';
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.finzen.apiUrl}${path}`, {
    method,
    headers: {
      'x-agent-key': config.finzen.agentKey,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new FinzenApiError(res.status, typeof json.message === 'string' ? json.message : `FinZen API error ${res.status}`);
  }
  return json as T;
}

// ── Tipos según el contrato (PRD §4) ──────────────────────────────────────

export interface KpisResponse {
  period: { from: string; to: string };
  users: { total: number; new_registrations: number; registration_change_pct: number; activated: number };
  // wau es opcional: pendiente de confirmar con FinZen (PRD §4.2) — puede no
  // venir todavía en la respuesta real. Nunca asumir su presencia.
  engagement: { dau: number; wau?: number; mau: number; retention_d1_pct: number; retention_d7_pct: number; retention_d30_pct: number };
  revenue: {
    mrr_usd: number;
    plan_distribution: Record<string, number>;
    churn_rate_pct: number;
    free_to_paid_rate_pct: number;
    trials: { active: number; started: number; conversion_rate_pct: number };
  };
  acquisition: {
    totals: { visitors: number; leads: number; registrations: number; subscriptions: number };
    by_source: Array<{
      source: string; campaign: string | null;
      visitors: number; leads: number; registrations: number; subscriptions: number;
      revenue_usd: number; cost_usd: number; conversion_rate_pct: number; cac_usd: number | null;
    }>;
  };
  campaigns: Array<{
    id: string; title: string; surface: string; sent_at: string; holdout_pct: number;
    exposed: number; holdout: number; impressions: number; clicks: number;
    exposed_tx_rate_pct: number; holdout_tx_rate_pct: number; lift_pts: number;
  }>;
}

export interface SegmentParamSpec {
  name: string;
  type: 'int' | 'string' | 'csv';
  required: boolean;
  default?: string | number;
  description: string;
}

export interface SegmentDef {
  slug: string;
  name: string;
  description: string;
  params: SegmentParamSpec[];
}

export interface SegmentEvaluation {
  slug: string;
  count: number;
  opted_out: number;
  params_used: Record<string, string>;
  evaluated_at: string;
}

/** Una fila de adquisición: combinación (source, campaign, medium) de la ventana. */
export interface AcquisitionWindowRow {
  source: string;              // 'Directo' cuando el evento no traía utm_source
  campaign: string | null;
  medium: string | null;
  visitors: number;            // visitantes únicos (PageView distinct)
  leads: number;               // RAW: cada click al CTA de descarga cuenta
  leads_unicos: number;        // distinct por identidad — la columna "Registros" del dashboard
}

export interface AcquisitionWindowResponse {
  window: { start: string; end: string; timezone: string }; // días inclusivos, hora RD
  rows: AcquisitionWindowRow[];
}

export interface CampaignDraftInput {
  title: string;          // ≤ 100 chars
  message: string;        // ≤ 200 chars
  segment_slug: string;   // debe existir en el catálogo
  segment_params?: Record<string, string | number>;
  rationale: string;      // ≥ 10 chars — siempre justificar con datos
  surface?: 'push' | 'slot' | 'both';
  holdout_pct?: number;   // 0-100, default 10
}

export interface CampaignDraftResult {
  id: string;
  status: 'PENDING_APPROVAL';
  message: string;
}

// ── Llamadas ──────────────────────────────────────────────────────────────

/**
 * KPIs del negocio para un rango de fechas (default: últimos 30 días).
 * `week_mode` (rolling|calendar) es un parámetro propuesto para `wau` — ver
 * PRD §4.2, pendiente de confirmar con FinZen; se envía igual, la API real
 * simplemente lo ignorará si todavía no lo soporta.
 */
export function getKpis(params?: { from?: string; to?: string; week_mode?: 'rolling' | 'calendar' }): Promise<KpisResponse> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.week_mode) qs.set('week_mode', params.week_mode);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  return request<KpisResponse>('GET', `/api/agent/kpis${suffix}`);
}

/**
 * Adquisición por (source, campaign, medium) de una ventana de días EN HORA RD.
 * Sin parámetros, FinZen devuelve la última semana completa lunes→domingo — es
 * la forma preferida: el corte de semana lo calcula el servidor en su zona y
 * Kaizen no tiene que hacer aritmética de husos.
 *
 * OJO — no confundir con getKpis().acquisition.by_source: ese es LIFETIME a
 * propósito (ignora from/to porque cruza costos por campaña sin granularidad
 * temporal). Para cualquier número "de esta semana" por red, va ESTE endpoint.
 */
export function getAcquisitionWindow(params?: { from?: string; to?: string }): Promise<AcquisitionWindowResponse> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  return request<AcquisitionWindowResponse>('GET', `/api/agent/acquisition-window${suffix}`);
}

/** Catálogo de segmentos curados. Leerlo en vivo: FinZen puede agregar segmentos. */
export async function listSegments(): Promise<SegmentDef[]> {
  const res = await request<{ segments: SegmentDef[] }>('GET', '/api/agent/segments');
  return res.segments;
}

/** Evalúa un segmento (solo conteos, nunca PII). */
export function evaluateSegment(slug: string, params?: Record<string, string | number>): Promise<SegmentEvaluation> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) qs.set(k, String(v));
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  return request<SegmentEvaluation>('GET', `/api/agent/segments/${encodeURIComponent(slug)}${suffix}`);
}

/**
 * Crea un BORRADOR de campaña (PENDING_APPROVAL). Un humano lo aprueba en el
 * panel de FinZen — Kaizen jamás envía. Llamar SOLO tras confirmación
 * explícita del socio en el chat (gate de doble aprobación, PRD §1.6).
 */
export function createCampaignDraft(input: CampaignDraftInput): Promise<CampaignDraftResult> {
  return request<CampaignDraftResult>('POST', '/api/agent/campaigns', input);
}
