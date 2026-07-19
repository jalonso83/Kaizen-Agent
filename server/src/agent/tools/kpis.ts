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

export const getKpisTool: KaizenTool = {
  name: 'get_kpis',
  description:
    'Obtiene los KPIs del negocio de FinZen (adquisición, activación, engagement, retención, ingresos y campañas pasadas con su lift) para un rango de fechas. ' +
    'LLÁMALA SIEMPRE antes de afirmar cualquier cifra del negocio; nunca respondas métricas de memoria. ' +
    'Rango por defecto: últimos 30 días. Los porcentajes vienen como puntos (31.0 = 31%).',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional; default: hace 30 días)' },
      to: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional; default: hoy)' },
    },
    required: [],
  },
  async execute(input) {
    const { from, to } = validateRange(input);
    const kpis = await getKpis({ from, to });
    return `${PCT_NOTE}\n${JSON.stringify(kpis)}`;
  },
};

export const getCampaignResultsTool: KaizenTool = {
  name: 'get_campaign_results',
  description:
    'Devuelve los resultados medidos (lift vs holdout) de las campañas enviadas en un período; sale del bloque "campaigns" de get_kpis. ' +
    'Úsala cuando el socio pregunte cómo le fue a una campaña, y ANTES de proponer una campaña similar (para citar el lift real de referencia). ' +
    'lift_pts positivo = la campaña movió la aguja; ~0 o negativo = no funcionó.',
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
      return `${PCT_NOTE}\n${JSON.stringify(one)}`;
    }

    if (all.length === 0) {
      return 'No hubo campañas medidas en este período. Prueba ampliar el rango de fechas con from/to.';
    }
    return `${PCT_NOTE}\n${JSON.stringify(all)}`;
  },
};
