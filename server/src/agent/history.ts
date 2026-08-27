import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';

// ─────────────────────────────────────────────────────────────────────────
// Historial multi-turno, persistencia y recovery — DISENO_FASE1.md §5.
//
// Decisión cerrada (§0.2): Message.content guarda los bloques CRUDOS de la API
// de Anthropic (text, thinking, tool_use, tool_result) tal cual. Reconstruir el
// historial es un SELECT + map → los pares tool_use/tool_result salen válidos
// gratis, y se elimina la clase entera de bugs de "historial inválido".
//
// Invariante sagrado: cualquier corte del historial ocurre SOLO en fronteras de
// turno humano; JAMÁS se separa un tool_use de su tool_result.
// ─────────────────────────────────────────────────────────────────────────

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlocks = BetaMessageParam['content'];

async function nextSeq(conversationId: string): Promise<number> {
  const agg = await db.message.aggregate({
    where: { conversationId },
    _max: { seq: true },
  });
  return (agg._max.seq ?? -1) + 1;
}

/** Persiste el mensaje del socio ANTES de llamar a Anthropic (orden de commits §4). */
export async function persistUserText(conversationId: string, text: string): Promise<void> {
  await db.message.create({
    data: {
      conversationId,
      seq: await nextSeq(conversationId),
      role: 'user',
      content: [{ type: 'text', text }] as object,
    },
  });
}

/**
 * Guarda como mensaje del assistant el TEXTO que Kaizen alcanzó a escribir
 * antes de que el socio interrumpiera la corrida (runner.ts). No pasa por
 * persistAssistantMessage porque no hay un BetaMessage completo del que sacar
 * los bloques: solo hay el texto acumulado de los deltas.
 */
export async function persistAssistantText(conversationId: string, text: string): Promise<void> {
  await db.message.create({
    data: {
      conversationId,
      seq: await nextSeq(conversationId),
      role: 'assistant',
      content: [{ type: 'text', text }] as object,
      stopReason: 'aborted',
    },
  });
}

/** Reconstruye [{role, content}] válido para la API, con recovery de tool_use huérfanos. */
export async function buildHistory(conversationId: string): Promise<BetaMessageParam[]> {
  const rows = await db.message.findMany({
    where: { conversationId },
    orderBy: { seq: 'asc' },
  });
  const messages = rows.map((r) => ({
    role: r.role as 'user' | 'assistant',
    content: r.content as ContentBlocks,
  }));

  return repararHuerfanos(messages);
}

/** Los `tool_use` de un mensaje del assistant. Vacío si no es un assistant. */
function toolUseIds(m: BetaMessageParam): string[] {
  if (m.role !== 'assistant' || !Array.isArray(m.content)) return [];
  return m.content
    .filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => (b as { type?: string }).type === 'tool_use')
    .map((b) => b.id);
}

/** Los `tool_result` que trae un mensaje del usuario. */
function toolResultIds(m: BetaMessageParam | undefined): Set<string> {
  if (!m || m.role !== 'user' || !Array.isArray(m.content)) return new Set();
  return new Set(
    m.content
      .filter((b): b is Anthropic.Beta.BetaToolResultBlockParam => (b as { type?: string }).type === 'tool_result')
      .map((b) => b.tool_use_id),
  );
}

/**
 * Recovery (§5): todo `tool_use` necesita su `tool_result` en el mensaje
 * INMEDIATAMENTE siguiente, o la API rechaza el historial entero.
 *
 * Se recorre TODO el historial y no solo el último mensaje. La versión anterior
 * miraba `messages[length - 1]`, lo cual bastaba mientras un corte a mitad de
 * turno dejara el assistant con tool_use al final. Desde que interrumpir guarda
 * el fragmento de texto (runner.ts, 2026-08-26) eso dejó de ser cierto:
 *
 *     assistant → con tool_use, sin su tool_result
 *     assistant → el fragmento guardado al interrumpir   ← el último ya no tiene tool_use
 *
 * La recuperación miraba el último, no veía tool_use, y el huérfano quedaba
 * enterrado — la conversación se rompía para siempre con "tool_use ids were
 * found without tool_result blocks" (bug real, 2026-08-27).
 *
 * La reparación es EN MEMORIA y no se persiste: insertar en medio exigiría
 * renumerar `seq` de todo lo posterior, y la BD debe guardar lo que de verdad
 * pasó. buildHistory es el único que lee estos bloques, así que reconstruir
 * bien en cada turno alcanza — y es idempotente.
 */
export function repararHuerfanos(messages: BetaMessageParam[]): BetaMessageParam[] {
  const salida: BetaMessageParam[] = [];

  for (let i = 0; i < messages.length; i++) {
    const actual = messages[i];
    salida.push(actual);

    const usados = toolUseIds(actual);
    if (usados.length === 0) continue;

    const resueltos = toolResultIds(messages[i + 1]);
    const huerfanos = usados.filter((id) => !resueltos.has(id));
    if (huerfanos.length === 0) continue;

    // Si el siguiente mensaje resuelve SOLO algunos, los que faltan igual
    // tienen que ir en ESE mismo mensaje, no en uno nuevo: la API exige que
    // todos los tool_result estén en el mensaje inmediatamente posterior.
    const sinteticos: Anthropic.Beta.BetaToolResultBlockParam[] = huerfanos.map((id) => ({
      type: 'tool_result',
      tool_use_id: id,
      is_error: true,
      content: 'La ejecución anterior se interrumpió antes de completar esta herramienta.',
    }));

    const siguiente = messages[i + 1];
    if (siguiente && siguiente.role === 'user' && Array.isArray(siguiente.content)) {
      salida.push({ role: 'user', content: [...sinteticos, ...siguiente.content] });
      i++; // ya se consumió
    } else {
      salida.push({ role: 'user', content: sinteticos });
    }
  }

  return salida;
}

/** Persiste un mensaje del assistant (bloques crudos + usage + stop_reason). */
export async function persistAssistantMessage(
  conversationId: string,
  message: Anthropic.Beta.BetaMessage,
): Promise<void> {
  await db.message.create({
    data: {
      conversationId,
      seq: await nextSeq(conversationId),
      role: 'assistant',
      content: message.content as object,
      inputTokens: message.usage?.input_tokens ?? null,
      outputTokens: message.usage?.output_tokens ?? null,
      stopReason: message.stop_reason ?? null,
    },
  });
}

/** Persiste el mensaje user con los tool_result que el runner generó (bloques crudos). */
export async function persistToolResultMessage(
  conversationId: string,
  content: ContentBlocks,
): Promise<void> {
  await db.message.create({
    data: {
      conversationId,
      seq: await nextSeq(conversationId),
      role: 'user',
      content: content as object,
    },
  });
}
