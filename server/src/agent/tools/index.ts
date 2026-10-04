import { withGuard, type KaizenTool, type ToolContext, type SseWriter } from './guard';
import { getKpisTool, getCampaignResultsTool } from './kpis';
import { listSegmentsTool, evaluateSegmentTool } from './segments';
import { loadSkillTool } from './skill';
import { proposeCampaignTool, createCampaignDraftTool, getMessageTypePerformanceTool } from './campaigns';
import { searchCerebroTool, saveContentDraftTool, saveCerebroNoteTool, listCerebroFoldersTool } from './cerebro';
import { proposeGoalTool, getActiveGoalTool, markGoalAchievedTool } from './goals';
import { getMetaCampaignsTool, getMetaSpendTool } from './meta';
import { listMarketingAccountsTool, getInstagramProfileTool } from './instagram';
import { getTiktokProfileTool } from './tiktok';
import { proposeMetaAdTool, getMetaAdResultsTool, recordMetaAdEvaluationTool } from './publicidad';

// ─────────────────────────────────────────────────────────────────────────
// Registro de tools de Kaizen — DISENO_FASE1.md §6. Las 9 originales +
// get_message_type_performance (2026-07-24, taxonomía de tipo de mensaje) +
// save_cerebro_note (2026-08-09, escritura en 50-kaizen/):
//   get_kpis · get_campaign_results · list_segments · evaluate_segment ·
//   load_skill · propose_campaign · create_campaign_draft (el gate, §7) ·
//   search_cerebro · save_content_draft (Contenidos) · save_cerebro_note
//   (50-kaizen/ — única carpeta del Cerebro con permiso de escritura) ·
//   get_message_type_performance (aprendizaje por estadística acumulada real)
//
// Fase 2 (2026-08-20) suma las de Meta, SOLO LECTURA: get_meta_campaigns ·
// get_meta_spend. Y (2026-09-11) las de Instagram, también solo lectura y
// solo sobre perfiles guardados en Marketing → Configuración:
// list_marketing_accounts · get_instagram_profile. La de escritura entra cuando FinZen habilite ads_management,
// y va a pasar por el mismo gate de confirmación que las de Fase 1.
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
  saveCerebroNoteTool,
  listCerebroFoldersTool,
  getMessageTypePerformanceTool,
  proposeGoalTool,
  getActiveGoalTool,
  markGoalAchievedTool,
  // Fase 2 — Meta, solo lectura (PRD §2.1: ads_read primero).
  getMetaCampaignsTool,
  getMetaSpendTool,
  // Instagram — solo lectura, solo perfiles guardados (tools/instagram.ts).
  listMarketingAccountsTool,
  getInstagramProfileTool,
  // TikTok — solo lectura, solo la cuenta propia (tools/tiktok.ts).
  getTiktokProfileTool,
  // Publicidad en Meta (2026-10-04): solo registra la tarjeta; lo que llega a
  // Meta lo crea el botón, en pausa (routes/adProposals.ts).
  proposeMetaAdTool,
  // Seguimiento de esos anuncios (2026-10-05): leer resultados y recomendar.
  getMetaAdResultsTool,
  recordMetaAdEvaluationTool,
];

/**
 * Subconjunto para la corrida del cron del resumen semanal (DISENO §12): SIN
 * tools de escritura hacia FinZen — un cron no debe *poder* crear borradores,
 * ni siquiera por un bug de prompt. Solo lecturas + Drive.
 */
const SOLO_CON_SOCIO = ['propose_campaign', 'create_campaign_draft', 'propose_goal', 'mark_goal_achieved', 'propose_meta_ad', 'record_meta_ad_evaluation'];
export const CRON_TOOL_LIST: KaizenTool[] = TOOL_LIST.filter((t) => !SOLO_CON_SOCIO.includes(t.name));

/**
 * La campaña diaria (2026-09-20) corre DENTRO de una conversación real, así
 * que la tarjeta la ve un socio: puede usar propose_campaign. Lo que sigue
 * fuera es lo que escribe hacia FinZen o cambia la meta: create_campaign_draft
 * (solo después del clic del socio, en el turno que dispara el botón, que es
 * una corrida normal) y las tools de metas. El cron pone la tarjeta; nunca el
 * borrador.
 */
export const DAILY_CAMPAIGN_TOOL_LIST: KaizenTool[] = TOOL_LIST.filter(
  (t) => !['create_campaign_draft', 'propose_goal', 'mark_goal_achieved', 'propose_meta_ad', 'record_meta_ad_evaluation'].includes(t.name),
);

/**
 * La publicidad automática (2026-10-04): lectura de Instagram, de Meta y del
 * Cerebro, y propose_meta_ad. Nada que escriba hacia FinZen ni las metas, y
 * nada de push: esta corrida es sobre pauta paga.
 */
const PUBLICIDAD = [
  'search_cerebro', 'list_cerebro_folders', 'load_skill', 'get_kpis',
  'list_marketing_accounts', 'get_instagram_profile', 'get_meta_campaigns', 'get_meta_spend',
  'propose_meta_ad', 'get_meta_ad_results',
];
export const META_ADS_TOOL_LIST: KaizenTool[] = TOOL_LIST.filter((t) => PUBLICIDAD.includes(t.name));

/**
 * La evaluación de un anuncio a los 7 días con gasto (2026-10-05): leer sus
 * resultados, el Cerebro y el Instagram, y dejar la recomendación. No puede
 * proponer otro anuncio ni tocar nada de FinZen.
 */
const EVALUACION = [
  'search_cerebro', 'load_skill', 'get_kpis', 'list_marketing_accounts', 'get_instagram_profile',
  'get_meta_campaigns', 'get_meta_ad_results', 'record_meta_ad_evaluation',
];
export const AD_EVALUATION_TOOL_LIST: KaizenTool[] = TOOL_LIST.filter((t) => EVALUACION.includes(t.name));

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
