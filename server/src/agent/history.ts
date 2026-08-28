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
 * Recovery (§5). La API impone DOS reglas simétricas sobre el historial, y
 * romper cualquiera de las dos lo rechaza entero:
 *
 *   1. Todo `tool_use` necesita su `tool_result` en el mensaje INMEDIATAMENTE
 *      siguiente.  →  "tool_use ids were found without tool_result blocks"
 *   2. Todo `tool_result` necesita su `tool_use` en el mensaje INMEDIATAMENTE
 *      anterior.   →  "unexpected tool_use_id found in tool_result blocks"
 *
 * Un historial puede llegar acá mal emparejado por dos vías: el orden de
 * persistencia viejo (`A1, A2, U1, U2`, ver runner.ts) o una corrida
 * interrumpida a mitad de una tool.
 *
 * POR QUÉ NO ALCANZA CON PARCHEAR DE A PARES: el primer intento (2026-08-27)
 * recorría el historial insertando los `tool_result` que faltaban, y con el
 * orden viejo emparejaba `A2` con `U1` — arrastrando el resultado de `A1`
 * detrás de `A2`, donde su `tool_use` ya no estaba. Cambiaba el error 1 por el
 * error 2. La lección: el emparejamiento hay que RECONSTRUIRLO, no remendarlo.
 *
 * Lo que hace esta versión:
 *   - Junta TODOS los `tool_result` del historial en un índice por id, sin
 *     importar en qué mensaje estaban.
 *   - Vuelve a colocarlos: detrás de cada assistant con `tool_use` va un user
 *     con el resultado REAL de cada id si existe, o uno sintético si no.
 *   - Descarta los `tool_result` sueltos que no correspondan a ningún
 *     `tool_use`, y el mensaje entero si no le queda nada más.
 *
 * Se conserva el resultado real cuando está: la tool llegó a correr y su dato
 * sirve — reemplazarlo por "se interrumpió" tiraría a la basura los KPIs que
 * Kaizen ya había traído.
 *
 * La reparación es EN MEMORIA y no se persiste: insertar en medio exigiría
 * renumerar `seq` de todo lo posterior, y la BD debe guardar lo que de verdad
 * pasó. buildHistory es el único que lee estos bloques, así que reconstruir
 * bien en cada turno alcanza — y es idempotente.
 */
export function repararHuerfanos(messages: BetaMessageParam[]): BetaMessageParam[] {
  // Índice de todos los resultados disponibles, estén donde estén.
  const resultados = new Map<string, Anthropic.Beta.BetaToolResultBlockParam>();
  for (const m of messages) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if ((b as { type?: string }).type === 'tool_result') {
        const tr = b as Anthropic.Beta.BetaToolResultBlockParam;
        resultados.set(tr.tool_use_id, tr);
      }
    }
  }

  const salida: BetaMessageParam[] = [];

  for (const m of messages) {
    const usados = toolUseIds(m);

    if (usados.length > 0) {
      salida.push(m);
      salida.push({
        role: 'user',
        content: usados.map(
          (id): Anthropic.Beta.BetaToolResultBlockParam =>
            resultados.get(id) ?? {
              type: 'tool_result',
              tool_use_id: id,
              is_error: true,
              content: 'La ejecución anterior se interrumpió antes de completar esta herramienta.',
            },
        ),
      });
      continue;
    }

    // Mensajes del usuario: se les quitan los tool_result, que ya se
    // recolocaron arriba. Si eran SOLO tool_result, el mensaje desaparece.
    if (m.role === 'user' && Array.isArray(m.content)) {
      const sinResultados = m.content.filter((b) => (b as { type?: string }).type !== 'tool_result');
      if (sinResultados.length === 0) continue;
      salida.push({ role: 'user', content: sinResultados });
      continue;
    }

    salida.push(m);
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
