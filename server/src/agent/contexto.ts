import type Anthropic from '@anthropic-ai/sdk';
import { todayInRD, todayInRDLegible } from '../util/fecha';

// ─────────────────────────────────────────────────────────────────────────
// El bloque <contexto> — dato volátil que el modelo necesita en CADA turno.
//
// Va dentro del turno de usuario, NUNCA en el system prompt (systemPrompt.ts
// §cabecera): el system prompt es el prefijo cacheado, y meterle la fecha lo
// invalidaría en cada turno, pagando el prefijo entero de nuevo.
//
// Tampoco se PERSISTE: se inyecta en la copia en memoria que va a la API,
// justo antes de llamar. Si se guardara en BD, cada mensaje viejo quedaría
// con la fecha del día en que se escribió y el modelo leería en el historial
// una decena de "hoy es..." contradictorios.
//
// Por qué existe (bug real, 2026-08-11): a Kaizen nunca se le decía qué día
// era. Sin reloj, lo deducía de su entrenamiento y erraba ("lunes 10 de
// agosto" cuando era martes 11). No es cosmético: la fecha alimenta los
// rangos from/to de get_kpis y get_campaign_results, así que un día mal
// deducido devuelve datos REALES de la ventana equivocada — sin ninguna
// señal de que algo salió mal.
// ─────────────────────────────────────────────────────────────────────────

/** Meta vigente resumida, o null. Se inyecta en cada turno a propósito: si
 *  dependiera de que el modelo llame a get_active_goal, podría "olvidarla" y
 *  proponer campañas que no apuntan a nada. */
export interface MetaVigente {
  id: string;
  resumen: string;
  desde: Date | null;
}

/** El bloque <contexto> listo para pegar en el turno de usuario. */
export function buildContextBlock(now: Date = new Date(), meta?: MetaVigente | null): string {
  const fecha =
    `Hoy es ${todayInRDLegible(now)} (${todayInRD(now)}), hora de República Dominicana. ` +
    `Usa esta fecha para cualquier rango from/to que le pases a las tools y para cualquier ` +
    `referencia temporal ("esta semana", "el mes pasado"). No la deduzcas por tu cuenta: ` +
    `esta línea es la única fuente de la fecha.`;

  const metaTexto = meta
    ? ` META VIGENTE (id ${meta.id}): ${meta.resumen}. Toda campaña que propongas debe apuntar a ella, y seguís experimentando hasta lograrla. ` +
      `No podés cambiarla ni darla por cerrada por tu cuenta: cambiarla exige que el socio lo pida Y confirme la tarjeta; cerrarla exige un número medido que la cumpla (mark_goal_achieved lo verifica).`
    : ' NO hay meta vigente. Si proponés una campaña, proponé también la meta con propose_goal.';

  return `<contexto>${fecha}${metaTexto}</contexto>`;
}

/**
 * Inyecta el <contexto> en el ÚLTIMO mensaje del socio, en la copia que va a
 * la API. Muta el array recibido (que ya es una copia recién armada por
 * buildHistory, no una referencia compartida).
 *
 * Solo actúa si el último mensaje es 'user'. Si fuera un 'assistant' —caso que
 * buildHistory ya evita con su recovery de tool_use huérfanos— agregar un
 * turno de usuario nuevo solo para la fecha haría que el modelo lo tomara como
 * un mensaje al que responder; mejor no tocar nada.
 */
export function injectDateContext(
  messages: Anthropic.Beta.BetaMessageParam[],
  now: Date = new Date(),
  meta?: MetaVigente | null,
): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return;

  const bloque = { type: 'text' as const, text: buildContextBlock(now, meta) };

  if (typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content }, bloque];
    return;
  }
  if (Array.isArray(last.content)) {
    last.content = [...last.content, bloque];
  }
}
