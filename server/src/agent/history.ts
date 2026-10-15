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

  return podarResultadosViejos(repararHuerfanos(messages));
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

/** Turnos humanos recientes cuyos resultados de tools viajan completos. */
export const TURNOS_COMPLETOS = 2;
/** De a cuántos turnos avanza el recorte (ver podarResultadosViejos, caché). */
export const PASO_PODA = 4;
/** Un resultado más corto que esto viaja siempre: recortarlo no ahorra nada. */
export const MIN_CHARS_PODA = 1500;

function textoDeResultado(tr: Anthropic.Beta.BetaToolResultBlockParam): string {
  if (typeof tr.content === 'string') return tr.content;
  if (!Array.isArray(tr.content)) return '';
  return tr.content.map((b) => ((b as { type?: string }).type === 'text' ? (b as { text: string }).text : '')).join('');
}

/** ¿Es un mensaje que escribió una persona (o un evento del sistema), y no solo tool_results? */
function esTurnoHumano(m: BetaMessageParam): boolean {
  if (m.role !== 'user') return false;
  if (typeof m.content === 'string') return true;
  return m.content.some((b) => (b as { type?: string }).type !== 'tool_result');
}

/**
 * Recorta los resultados de tools GRANDES de los turnos viejos (2026-10-10).
 *
 * Sin esto, cada pedido reenviaba la conversación entera, con todos los
 * resultados de tools desde el primer mensaje. Una lectura de Instagram pesa
 * ~11-18k tokens; la conversación de la campaña diaria suma una corrida por
 * día y el resumen semanal reutilizaba la misma conversación cada semana, así
 * que el costo crecía sin techo (y con el tiempo, el límite de contexto).
 *
 * Qué queda: los resultados completos de los últimos TURNOS_COMPLETOS turnos
 * humanos (donde Kaizen todavía los está usando) y los cortos de cualquier
 * turno. El texto y el razonamiento de Kaizen se conservan enteros: ahí están
 * las cifras que ya citó. Lo recortado se reemplaza por una línea que dice qué
 * tool era y que se puede volver a pedir.
 *
 * Es EN MEMORIA, como repararHuerfanos: la BD guarda todo, y los candados del
 * gate (segment_count, lectura del Cerebro) leen el audit log, no esto.
 *
 * Caché: el recorte es determinista y avanza DE A PASO_PODA turnos
 * (2026-10-15). Si avanzara de a uno, cada turno nuevo cambiaría el prefijo en
 * el turno que pasa a ser viejo, y todo lo posterior se reescribiría en el
 * caché (1,25×) en vez de leerse (0,1×). De a 4, el prefijo cambia una vez
 * cada 4 turnos; entre recorte y recorte viajan completos entre
 * TURNOS_COMPLETOS y TURNOS_COMPLETOS + PASO_PODA - 1 turnos.
 *
 * OJO si se migra a un modelo con "preserved thinking" (Opus 5.5, Fable 5.1):
 * esos modelos rechazan o descartan el razonamiento si se edita la historia
 * anterior. Con Opus 4.8 no aplica. Revisar esto antes de cambiar de modelo.
 */
export function podarResultadosViejos(
  messages: BetaMessageParam[],
  turnosCompletos = TURNOS_COMPLETOS,
  paso = PASO_PODA,
): BetaMessageParam[] {
  // Cuántos turnos se recortan: múltiplo de `paso`, para que el corte (y con
  // él el prefijo cacheado) se mueva de a saltos y no en cada turno.
  const humanos = messages.map((m, i) => (esTurnoHumano(m) ? i : -1)).filter((i) => i >= 0);
  const recortables = Math.floor((humanos.length - turnosCompletos) / paso) * paso;
  if (recortables <= 0) return messages;
  const corte = humanos[recortables];

  // Nombre de la tool por id, para que la línea que queda diga qué era.
  const nombres = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if ((b as { type?: string }).type === 'tool_use') {
        const tu = b as Anthropic.Beta.BetaToolUseBlockParam;
        nombres.set(tu.id, tu.name);
      }
    }
  }

  return messages.map((m, i) => {
    if (i >= corte || m.role !== 'user' || !Array.isArray(m.content)) return m;
    let cambio = false;
    const content = m.content.map((b) => {
      if ((b as { type?: string }).type !== 'tool_result') return b;
      const tr = b as Anthropic.Beta.BetaToolResultBlockParam;
      const texto = textoDeResultado(tr);
      if (texto.length < MIN_CHARS_PODA) return b;
      cambio = true;
      const tool = nombres.get(tr.tool_use_id) ?? 'la tool';
      return {
        type: 'tool_result',
        tool_use_id: tr.tool_use_id,
        ...(tr.is_error ? { is_error: true } : {}),
        content:
          `[Resultado de ${tool} de un turno anterior, omitido para no reenviarlo (${texto.length} caracteres). ` +
          'Lo que importaba ya está en tu respuesta de ese turno. Si necesitas el dato de nuevo o actualizado, vuelve a llamar a la tool.]',
      } as Anthropic.Beta.BetaToolResultBlockParam;
    });
    return cambio ? { ...m, content } : m;
  });
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
      cacheReadTokens: message.usage?.cache_read_input_tokens ?? null,
      cacheWriteTokens: message.usage?.cache_creation_input_tokens ?? null,
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
