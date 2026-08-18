import { getKpis } from '../../clients/finzenApi';
import type { KaizenTool } from './guard';

// ─────────────────────────────────────────────────────────────────────────
// Tools de KPIs — leen la Agent API de FinZen (solo agregados, nunca PII).
// DISENO_FASE1.md §6. Devuelven el JSON crudo + una línea-guía; Claude lo
// interpreta. Regla dura #1 del system prompt: el modelo NUNCA inventa cifras,
// siempre pasan por aquí.
// ─────────────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PCT_NOTE = 'Nota: los campos *_pct vienen como puntos porcentuales (31.0 significa 31%).';

// Dos avisos que viajan CON el dato, no solo en el system prompt: son los dos
// errores de lectura que ya se cometieron sobre esta misma respuesta.
const PLANES_NOTE =
  'OJO con revenue.plan_distribution: cuenta usuarios POR PLAN e incluye a los que están en prueba gratis. ' +
  'NO son "usuarios de pago" ni se suman para dar un total de pagos. Quienes pagan son los que sostienen revenue.mrr_usd; ' +
  'revenue.trials.active dice cuántos están en prueba. Verifica contra el MRR y los precios de los planes antes de afirmar un número de pagos.';
const CAMPANAS_NOTE =
  'OJO con campaigns: SOLO trae campañas ya ENVIADAS, y sent_at es su fecha real de publicación (úsala tal cual). ' +
  'Los borradores en PENDING_APPROVAL no aparecen acá: si una campaña no está en esta lista, no se publicó. Dilo explícitamente al mencionarlas.';

/** Valida from/to: formato YYYY-MM-DD y from ≤ to. Lanza error recuperable. */
function validateRange(input: Record<string, unknown>): { from?: string; to?: string } {
  const from = input.from as string | undefined;
  const to = input.to as string | undefined;
  for (const [k, v] of Object.entries({ from, to })) {
    if (v !== undefined && !DATE_RE.test(v)) {
      throw new Error(`El parámetro "${k}" debe tener formato YYYY-MM-DD (recibí "${v}"). Corrige la fecha y vuelve a llamar.`);
    }
  }
  if (from && to && from > to) {
    throw new Error(`El rango es inválido: "from" (${from}) es posterior a "to" (${to}). Invierte las fechas.`);
  }
  return { from, to };
}

const WEEK_MODES = ['rolling', 'calendar'] as const;

export const getKpisTool: KaizenTool = {
  name: 'get_kpis',
  description:
    'Obtiene los KPIs del negocio de FinZen (adquisición, activación, engagement, retención, ingresos y campañas pasadas con su lift) para un rango de fechas. ' +
    'LLÁMALA SIEMPRE antes de afirmar cualquier cifra del negocio; nunca respondas métricas de memoria. ' +
    'Rango por defecto: últimos 30 días. Los porcentajes vienen como puntos (31.0 = 31%). ' +
    'engagement.wau (usuarios activos semanales) es un campo pendiente de confirmar con FinZen — puede faltar en la respuesta real; si no aparece, no lo inventes, dilo y usa evaluate_segment con el segmento "active" y days=7 como alternativa. ' +
    'DOS LECTURAS QUE NO DEBES HACER: (1) revenue.plan_distribution NO son usuarios de pago — cuenta usuarios por plan incluyendo los que están en prueba gratis; quienes pagan son los que sostienen revenue.mrr_usd y revenue.trials.active dice cuántos están en prueba. ' +
    '(2) campaigns SOLO trae campañas ya enviadas, con sent_at como fecha real de publicación; tus borradores en PENDING_APPROVAL no aparecen ahí.',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional; default: hace 30 días)' },
      to: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional; default: hoy)' },
      week_mode: {
        type: 'string',
        enum: [...WEEK_MODES],
        description:
          'Solo afecta a engagement.wau. "rolling" (default): últimos 7 días terminando en "to". ' +
          '"calendar": última semana completa de lunes a domingo (si "to" cae a mitad de semana, usa la anterior ya cerrada, no la parcial).',
      },
    },
    required: [],
  },
  async execute(input) {
    const { from, to } = validateRange(input);
    const weekModeInput = input.week_mode as string | undefined;
    if (weekModeInput && !WEEK_MODES.includes(weekModeInput as (typeof WEEK_MODES)[number])) {
      throw new Error(`"week_mode" debe ser uno de: ${WEEK_MODES.join(', ')} (recibí "${weekModeInput}").`);
    }
    const week_mode = weekModeInput as 'rolling' | 'calendar' | undefined;
    const kpis = await getKpis({ from, to, week_mode });
    return [PCT_NOTE, PLANES_NOTE, CAMPANAS_NOTE, JSON.stringify(kpis)].join('\n');
  },
};

export const getCampaignResultsTool: KaizenTool = {
  name: 'get_campaign_results',
  description:
    'Devuelve los resultados medidos (lift vs holdout) de las campañas YA ENVIADAS en un período; sale del bloque "campaigns" de get_kpis. ' +
    'Úsala cuando el socio pregunte cómo le fue a una campaña, y ANTES de proponer una campaña similar (para citar el lift real de referencia). ' +
    'lift_pts positivo = la campaña movió la aguja; ~0 o negativo = no funcionó. ' +
    'Cada campaña trae sent_at: esa es su fecha REAL de publicación, úsala tal cual y menciónala al hablar de ella. ' +
    'Lo que NO está acá no se publicó: los borradores que tú creas quedan en PENDING_APPROVAL y solo aparecen en esta lista una vez que un humano de FinZen los aprueba y salen.',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional)' },
      to: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional)' },
      campaign_id: { type: 'string', description: 'Si se indica, filtra a esa campaña (opcional)' },
    },
    required: [],
  },
  async execute(input) {
    const { from, to } = validateRange(input);
    const kpis = await getKpis({ from, to });
    const all = kpis.campaigns ?? [];
    const campaignId = input.campaign_id as string | undefined;

    if (campaignId) {
      const one = all.find((c) => c.id === campaignId);
      if (!one) {
        const ids = all.map((c) => c.id).join(', ') || '(ninguna en el período)';
        throw new Error(`No encontré la campaña "${campaignId}" en este período. Campañas disponibles: ${ids}. Amplía el rango de fechas o usa uno de esos ids.`);
      }
      return [PCT_NOTE, CAMPANAS_NOTE, JSON.stringify(one)].join('\n');
    }

    if (all.length === 0) {
      return 'No hubo campañas medidas en este período. Prueba ampliar el rango de fechas con from/to.';
    }
    return [PCT_NOTE, CAMPANAS_NOTE, JSON.stringify(all)].join('\n');
  },
};
