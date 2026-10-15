import { todayInRD, todayInRDLegible } from '../util/fecha';

// ─────────────────────────────────────────────────────────────────────────
// El bloque <contexto> — dato volátil que el modelo necesita en CADA turno.
//
// Va como ÚLTIMO bloque del system prompt, después de los dos cortes de caché
// (systemPrompt.ts). Hasta 2026-10-15 iba dentro del último mensaje del socio,
// y eso costaba caro: en el turno siguiente ese mensaje ya no lo tenía, el
// prefijo cambiaba ahí y todo el turno anterior (con sus resultados de tools)
// se volvía a escribir en el caché en cada turno. En el system, y con la fecha
// SIN hora, cambia una vez por día.
//
// No se PERSISTE: se arma en cada pedido, justo antes de llamar. Si se guardara en BD, cada mensaje viejo quedaría
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
    ? ` META VIGENTE (id ${meta.id}): ${meta.resumen}. Toda campaña que propongas debe apuntar a ella, y sigues experimentando hasta lograrla. ` +
      `No puedes cambiarla ni darla por cerrada por tu cuenta: cambiarla exige que el socio lo pida Y confirme la tarjeta; cerrarla exige un número medido que la cumpla (mark_goal_achieved lo verifica).`
    : ' NO hay meta vigente. Si propones una campaña, propón también la meta con propose_goal.';

  return `<contexto>${fecha}${metaTexto}</contexto>`;
}
