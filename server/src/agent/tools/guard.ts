import { audit } from '../../services/audit';

// ─────────────────────────────────────────────────────────────────────────
// Infraestructura común de TODAS las tools — DISENO_FASE1.md §6.
//
// withGuard envuelve cada tool: (1) emite tool_start al SSE; (2) ejecuta con
// timeout duro de 30s; (3) inserta en el audit log (tool, input, resumen ≤2000,
// isError, durationMs, conversationId); (4) en error LANZA — el runner lo
// convierte en tool_result con is_error: true para que el modelo se recupere.
//
// Regla de oro de los mensajes de error: se redactan PARA el modelo, con
// instrucción de recuperación (no "HTTP 429" sino "se alcanzó el límite... NO
// reintentes hoy; informa al socio"). Cada tool.execute es responsable de
// lanzar Error con un mensaje así.
// ─────────────────────────────────────────────────────────────────────────

/** Escritor de eventos SSE hacia la web del socio (lo provee el runner). */
export interface SseWriter {
  send(event: string, data: unknown): void;
}

/** Contexto de una corrida, compartido por todas las tools de ese turno. */
export interface ToolContext {
  conversationId: string | null; // null en la corrida del cron (resumen semanal)
  sse?: SseWriter; // ausente en corridas sin UI (cron, tests)
}

/**
 * Una tool de Kaizen, desacoplada del SDK de Anthropic a propósito: el runner
 * (único módulo que toca el SDK beta, DISENO §14) adapta estas definiciones al
 * formato que espere `toolRunner`. `execute` devuelve el string que va como
 * contenido del tool_result.
 */
export interface KaizenTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema del input
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

const TIMEOUT_MS = 30_000;

// Etiquetas humanas para la barra de estado del chat ("Kaizen está…").
const LABELS: Record<string, string> = {
  get_kpis: 'Consultando KPIs…',
  get_campaign_results: 'Revisando resultados de campañas…',
  list_segments: 'Listando segmentos…',
  evaluate_segment: 'Evaluando segmento…',
  load_skill: 'Cargando su método…',
  search_cerebro: 'Buscando en el Cerebro…',
  save_content_draft: 'Guardando contenido…',
  propose_campaign: 'Preparando la propuesta…',
  create_campaign_draft: 'Creando el borrador en FinZen…',
};

function truncate(s: string, n = 2000): string {
  return s.length > n ? `${s.slice(0, n)}…[+${s.length - n} chars]` : s;
}

function withTimeout<T>(promise: Promise<T>, toolName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `La herramienta ${toolName} superó el límite de ${TIMEOUT_MS / 1000}s y se canceló. ` +
            `No reintentes de inmediato; informa al socio que la fuente de datos está lenta.`,
        ),
      );
    }, TIMEOUT_MS);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Corre una tool con audit + timeout + eventos SSE. Lanza en error (recuperable). */
export async function withGuard(
  tool: KaizenTool,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const startedAt = Date.now();
  ctx.sse?.send('tool_start', { name: tool.name, label: LABELS[tool.name] ?? 'Trabajando…' });

  try {
    const result = await withTimeout(tool.execute(input, ctx), tool.name);
    await audit.log({
      conversationId: ctx.conversationId,
      actor: 'agent',
      action: `tool:${tool.name}`,
      input,
      resultSummary: truncate(result),
      isError: false,
      durationMs: Date.now() - startedAt,
    });
    ctx.sse?.send('tool_end', { name: tool.name, ok: true });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await audit.log({
      conversationId: ctx.conversationId,
      actor: 'agent',
      action: `tool:${tool.name}`,
      input,
      resultSummary: truncate(message),
      isError: true,
      durationMs: Date.now() - startedAt,
    });
    ctx.sse?.send('tool_end', { name: tool.name, ok: false });
    throw err instanceof Error ? err : new Error(message);
  }
}
