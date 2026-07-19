import { withGuard, type KaizenTool, type ToolContext, type SseWriter } from './guard';
import { getKpisTool, getCampaignResultsTool } from './kpis';
import { listSegmentsTool, evaluateSegmentTool } from './segments';
import { loadSkillTool } from './skill';

// ─────────────────────────────────────────────────────────────────────────
// Registro de tools de Kaizen — DISENO_FASE1.md §6.
//
// Construidas (slice 1 — lecturas + carga de método, sin nuevas tablas/endpoints):
//   get_kpis · get_campaign_results · list_segments · evaluate_segment · load_skill
//
// Pendientes (necesitan más infraestructura, se agregan aquí al construirse):
//   - propose_campaign, create_campaign_draft → tabla Proposal + endpoints
//     confirm/reject + el GATE de confirmación (DISENO §7). NO agregar hasta que
//     el gate exista, o se rompe el guardarraíl de "nunca crear sin confirmar".
//   - search_cerebro, save_content_draft → índice FTS del Cerebro + creación de
//     Google Docs en Contenidos (DISENO §9). Requiere extender clients/drive.ts.
//
// El runner (único módulo que toca el SDK beta de Anthropic, §14) adapta esta
// lista a `toolRunner`; withGuard queda del lado nuestro (audit + timeout + SSE).
// ─────────────────────────────────────────────────────────────────────────

export type { KaizenTool, ToolContext, SseWriter };
export { withGuard };

/** Todas las tools implementadas hasta ahora. */
export const TOOL_LIST: KaizenTool[] = [
  getKpisTool,
  getCampaignResultsTool,
  listSegmentsTool,
  evaluateSegmentTool,
  loadSkillTool,
];

/** Registro por nombre, para despachar una llamada del modelo. */
export const TOOLS: Record<string, KaizenTool> = Object.fromEntries(
  TOOL_LIST.map((t) => [t.name, t]),
);

/**
 * Ejecuta una tool por nombre con todos los guardarraíles (audit, timeout, SSE).
 * Un nombre desconocido lanza un error recuperable para que el modelo corrija.
 */
export function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const tool = TOOLS[name];
  if (!tool) {
    return Promise.reject(
      new Error(`No existe la herramienta "${name}". Herramientas disponibles: ${Object.keys(TOOLS).join(', ')}.`),
    );
  }
  return withGuard(tool, input, ctx);
}
