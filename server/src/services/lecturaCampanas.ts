import type { KpisResponse } from '../clients/finzenApi';

// ─────────────────────────────────────────────────────────────────────────
// Lectura de una campaña de push ya enviada (2026-10-26, plan de mensajería
// interna, docs/plan-mensajeria-interna.html). Antes Kaizen leía el lift_pts
// tal cual, y eso producía tres errores que el reporte de impacto encontró:
//
//   1. Campañas SIN ENTREGA leídas como "sin efecto". El 14-sep tuvo 0
//      impresiones y jul–ago se entregó el 2–3 %: ahí el lift no mide el
//      mensaje, mide que el mensaje no llegó.
//   2. Campañas con la VENTANA ABIERTA usadas para recomendar. La tasa de
//      transacción se mide a 7 días del envío; antes de eso el número se mueve.
//   3. Márgenes calculados con una tasa base de ~50 %, que los infla de 2 a 8
//      veces. Con las tasas reales (0–6 %) el margen es otro.
//
// Todo eso se calcula ACÁ, en código, y viaja junto a cada campaña: el modelo
// recibe la lectura hecha y no tiene que acordarse de la regla.
// ─────────────────────────────────────────────────────────────────────────

export type Campana = KpisResponse['campaigns'][number];

/** La tasa de transacción se mide a 7 días del envío (ventana de FinZen). */
export const VENTANA_DIAS = 7;

/**
 * Por debajo de este % de impresiones sobre expuestos, la campaña no se lee.
 * Las fallidas que se conocen están en 0–3 %; el corte deja margen para una
 * entrega parcial sin bautizar "medible" a una que casi no llegó. Ajustable
 * cuando FinZen confirme cuál es la entrega normal de su proveedor de push.
 */
export const ENTREGA_MINIMA_PCT = 50;

export type Veredicto =
  | 'no_medible_entrega' // no llegó: el lift no dice nada del mensaje
  | 'ventana_abierta' // todavía no se puede leer
  | 'sin_control' // sin holdout no hay contra qué comparar
  | 'sin_datos' // FinZen no mandó la fecha de envío, las tasas o el lift
  | 'indistinguible' // el efecto cabe dentro del margen
  | 'positivo'
  | 'negativo';

export interface LecturaCampana {
  /** Impresiones / expuestos × 100, un decimal. Null si no hubo expuestos. */
  entrega_pct: number | null;
  /** YYYY-MM-DD en que cierra la ventana de 7 días. Null si sent_at no es una fecha válida. */
  ventana_cierra: string | null;
  ventana_cerrada: boolean;
  /** lift × expuestos: cuántos usuarios de más transaccionaron por la campaña. */
  usuarios_incrementales: number;
  /** ± margen al 95 %, en usuarios, con la tasa REAL (no 50 %). Null sin control. */
  margen_usuarios: number | null;
  veredicto: Veredicto;
  /** Una línea que el modelo puede citar tal cual. */
  lectura: string;
}

const redondear = (n: number, dec = 0) => Math.round(n * 10 ** dec) / 10 ** dec;

/** Null si la fecha no es válida: un sent_at roto no puede tumbar toda la lectura de KPIs. */
function sumarDias(iso: string, dias: number): Date | null {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t + dias * 86_400_000) : null;
}

/**
 * Margen al 95 % del efecto en usuarios, con la fórmula del reporte de impacto:
 * 1,96 × √(p(1−p)(1/expuestos + 1/control)) × expuestos, con p la tasa de
 * transacción combinada de los dos brazos.
 */
export function margenUsuarios(c: Pick<Campana, 'exposed' | 'holdout' | 'exposed_tx_rate_pct' | 'holdout_tx_rate_pct'>): number | null {
  if (!(c.exposed > 0) || !(c.holdout > 0)) return null;
  const p = (c.exposed * (c.exposed_tx_rate_pct / 100) + c.holdout * (c.holdout_tx_rate_pct / 100)) / (c.exposed + c.holdout);
  if (!Number.isFinite(p)) return null; // faltan las tasas: no se inventa un margen
  // Con p = 0 (nadie transaccionó en ningún brazo) la fórmula da 0, que no es
  // "margen nulo": es falta de eventos. Se usa medio evento como piso para no
  // presentar como exacto un resultado que solo dice "no hubo nada que ver".
  const pEf = p > 0 ? p : 0.5 / (c.exposed + c.holdout);
  return redondear(1.96 * Math.sqrt(pEf * (1 - pEf) * (1 / c.exposed + 1 / c.holdout)) * c.exposed);
}

export function leerCampana(c: Campana, ahora: Date = new Date()): LecturaCampana {
  // Sin impresiones informadas (campo ausente) no hay entrega confirmada: es
  // "no medible" igual, pero se dice que falta el dato, no que fue 0 %.
  const hayImpresiones = typeof c.impressions === 'number' && Number.isFinite(c.impressions);
  const entrega = c.exposed > 0 && hayImpresiones ? redondear((c.impressions / c.exposed) * 100, 1) : null;
  const cierre = sumarDias(c.sent_at, VENTANA_DIAS);
  const cerrada = cierre != null && ahora.getTime() >= cierre.getTime();
  const incrementales = redondear((c.lift_pts / 100) * c.exposed);
  const margen = margenUsuarios(c);
  const efecto = `${incrementales >= 0 ? '+' : ''}${incrementales} usuarios${margen != null ? ` ± ${margen}` : ''}`;

  let veredicto: Veredicto;
  let lectura: string;
  if (entrega == null || entrega < ENTREGA_MINIMA_PCT) {
    veredicto = 'no_medible_entrega';
    lectura =
      (entrega == null
        ? `No medible: ${c.exposed > 0 ? 'FinZen no informó impresiones' : 'no tuvo expuestos'}, así que no hay entrega confirmada. `
        : `No medible: se entregó al ${entrega} % de los expuestos (mínimo ${ENTREGA_MINIMA_PCT} %). `) +
      'El resultado no dice nada del mensaje. No la cuentes como "sin efecto".';
  } else if (cierre == null) {
    veredicto = 'sin_datos';
    lectura = 'FinZen no informó una fecha de envío válida: no se sabe si la ventana cerró. No la uses para concluir.';
  } else if (!cerrada) {
    veredicto = 'ventana_abierta';
    lectura = `Ventana abierta hasta el ${cierre.toISOString().slice(0, 10)}: el número todavía se mueve. No la uses para concluir ni para recomendar.`;
  } else if (margen == null && c.holdout > 0) {
    veredicto = 'sin_datos';
    lectura = 'FinZen no informó las tasas de los dos brazos: no hay forma de calcular el efecto ni su margen.';
  } else if (margen == null) {
    veredicto = 'sin_control';
    lectura = 'Sin grupo de control: no hay contra qué comparar. No se puede atribuir ningún efecto a la campaña.';
  } else if (!Number.isFinite(incrementales)) {
    veredicto = 'sin_datos';
    lectura = 'FinZen no informó el lift: no hay efecto que leer.';
  } else if (Math.abs(incrementales) <= margen) {
    veredicto = 'indistinguible';
    lectura = `Indistinguible de cero: ${efecto}. El efecto cabe dentro del margen; no demuestra ni que funcionó ni que no.`;
  } else {
    veredicto = incrementales > 0 ? 'positivo' : 'negativo';
    lectura = `${veredicto === 'positivo' ? 'Efecto positivo' : 'Efecto negativo'} fuera del margen: ${efecto}.`;
  }

  return {
    entrega_pct: entrega,
    ventana_cierra: cierre ? cierre.toISOString().slice(0, 10) : null,
    ventana_cerrada: cerrada,
    usuarios_incrementales: incrementales,
    margen_usuarios: margen,
    veredicto,
    lectura,
  };
}

/** Solo estas cuentan para comparar enfoques o para recomendar: llegaron, cerraron y tenían control. */
export function esLegible(l: LecturaCampana): boolean {
  return l.veredicto === 'indistinguible' || l.veredicto === 'positivo' || l.veredicto === 'negativo';
}

/**
 * El total de un período: la suma de los efectos de las campañas legibles, y
 * su margen como la raíz de la suma de los cuadrados (las campañas son
 * independientes). Mismo método que el reporte de impacto.
 */
export function totalPeriodo(lecturas: LecturaCampana[]): { campanas_legibles: number; usuarios_incrementales: number; margen_usuarios: number | null } {
  const legibles = lecturas.filter(esLegible);
  const suma = legibles.reduce((a, l) => a + l.usuarios_incrementales, 0);
  const cuadrados = legibles.reduce((a, l) => a + (l.margen_usuarios ?? 0) ** 2, 0);
  return {
    campanas_legibles: legibles.length,
    usuarios_incrementales: redondear(suma),
    margen_usuarios: legibles.length ? redondear(Math.sqrt(cuadrados)) : null,
  };
}
