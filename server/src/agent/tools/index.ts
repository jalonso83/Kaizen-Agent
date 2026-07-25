import { withGuard, type KaizenTool, type ToolContext, type SseWriter } from './guard';
import { getKpisTool, getCampaignResultsTool } from './kpis';
import { listSegmentsTool, evaluateSegmentTool } from './segments';
import { loadSkillTool } from './skill';
import { proposeCampaignTool, createCampaignDraftTool, getMessageTypePerformanceTool } from './campaigns';
import { searchCerebroTool, saveContentDraftTool } from './cerebro';

// ─────────────────────────────────────────────────────────────────────────
// Registro de tools de Kaizen — DISENO_FASE1.md §6. Las 9 originales +
// get_message_type_performance (2026-07-24, taxonomía de tipo de mensaje):
//   get_kpis · get_campaign_results · list_segments · evaluate_segment ·
//   load_skill · propose_campaign · create_campaign_draft (el gate, §7) ·
//   search_cerebro · save_content_draft (el Cerebro, §9) ·
//   get_message_type_performance (aprendizaje por estadística acumulada real)
//
// El runner (único módulo que toca el SDK beta de Anthropic, §14) adapta esta
// lista a `toolRunner`; withGuard queda del lado nuestro (audit + timeout + SSE).
// ─────────────────────────────────────────────────────────────────────────

export type { KaizenTool, ToolContext, SseWriter };
export { withGuard };

/** Todas las tools implementadas. */
export const TOOL_LIST: KaizenTool[] = [
  getKpisTool,
  getCampaignResultsTool,
  listSegmentsTool,
  evaluateSegmentTool,
  loadSkillTool,
  proposeCampaignTool,
  createCampaignDraftTool,
  searchCerebroTool,
  saveContentDraftTool,
  getMessageTypePerformanceTool,
];

/**
 * Subconjunto para la corrida del cron del resumen semanal (DISENO §12): SIN
 * tools de escritura hacia FinZen — un cron no debe *poder* crear borradores,
 * ni siquiera por un bug de prompt. Solo lecturas + Drive.
 */
export const CRON_TOOL_LIST: KaizenTool[] = TOOL_LIST.filter(
  (t) => t.name !== 'propose_campaign' && t.name !== 'create_campaign_draft',
);

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
