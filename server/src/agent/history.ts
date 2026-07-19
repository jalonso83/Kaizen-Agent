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

  // Recovery (§5): si el último mensaje es un assistant con tool_use SIN su
  // tool_result (crash a mitad de turno), insertar un user con tool_result
  // sintético por cada tool_use huérfano. Se persiste para dejar la BD consistente.
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && Array.isArray(last.content)) {
    const orphanIds = last.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => (b as { type?: string }).type === 'tool_use')
      .map((b) => b.id);
    if (orphanIds.length > 0) {
      const recovery: Anthropic.Beta.BetaToolResultBlockParam[] = orphanIds.map((id) => ({
        type: 'tool_result',
        tool_use_id: id,
        is_error: true,
        content: 'La ejecución anterior se interrumpió antes de completar esta herramienta.',
      }));
      await db.message.create({
        data: {
          conversationId,
          seq: await nextSeq(conversationId),
          role: 'user',
          content: recovery as object,
        },
      });
      messages.push({ role: 'user', content: recovery });
    }
  }

  return messages;
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
