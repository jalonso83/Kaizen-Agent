import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { TOOL_LIST } from './tools';
import { withGuard, type KaizenTool, type ToolContext } from './tools/guard';

// ─────────────────────────────────────────────────────────────────────────
// Adaptador: convierte las KaizenTool (desacopladas del SDK) en las betaTool
// que consume `client.beta.messages.toolRunner`. Aquí es donde el mundo del
// agente (withGuard: audit + timeout + SSE) se enchufa al SDK beta. Es, junto
// con runner.ts, el único punto que toca el SDK — si su API beta cambia, solo
// se ajusta acá (DISENO_FASE1.md §14).
//
// La tool se cierra sobre `ctx` (conversationId + SSE) de ESTA corrida. En
// error, withGuard lanza; el toolRunner lo convierte en un tool_result con
// is_error para que el modelo se recupere.
// ─────────────────────────────────────────────────────────────────────────

/** `toolList` por defecto TOOL_LIST completa; el cron pasa CRON_TOOL_LIST (sin escritura a FinZen). */
export function buildBetaTools(ctx: ToolContext, toolList: KaizenTool[] = TOOL_LIST) {
  return toolList.map((tool) =>
    betaTool({
      name: tool.name,
      description: tool.description,
      // Nuestros inputSchema son JSON Schema planos; el helper los acepta.
      inputSchema: tool.inputSchema as Parameters<typeof betaTool>[0]['inputSchema'],
      run: async (args) => withGuard(tool, (args ?? {}) as Record<string, unknown>, ctx),
    }),
  );
}
