// ─────────────────────────────────────────────────────────────────────────
// Fechas en hora de República Dominicana.
//
// `new Date().toISOString().slice(0,10)` es UTC, y RD es UTC-4: a partir de
// las 8pm hora local, UTC ya está en el día siguiente. Todo lo que sea "hoy"
// de cara al socio (nombres de archivo, rangos de KPIs, el bloque <contexto>)
// tiene que salir de acá, no de toISOString().
// ─────────────────────────────────────────────────────────────────────────

export const TZ_RD = 'America/Santo_Domingo'; // UTC-4 todo el año (RD no aplica horario de verano)

/** HOY en RD como YYYY-MM-DD — el formato que piden las tools. */
export function todayInRD(now: Date = new Date()): string {
  // 'en-CA' formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_RD,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** HOY en RD en prosa: "martes, 11 de agosto de 2026". */
export function todayInRDLegible(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: TZ_RD,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);
}
