import { audit } from './audit';

// ─────────────────────────────────────────────────────────────────────────
// Saldo agotado en la cuenta de Anthropic (2026-10-13).
//
// Pasó el 12-oct: la API respondió "Your credit balance is too low to access
// the Anthropic API" y Kaizen lo mostró como "petición inválida", en inglés,
// sin decir qué hacer. Y como runAgentTurn se tragaba el error, los jobs
// registraban "corrió" aunque el modelo no hubiera respondido.
//
// Esto:
//   1. Reconoce el error, venga de donde venga (chat, jobs, visión, títulos).
//   2. Lo explica en castellano, con lo que hay que hacer.
//   3. Avisa en Auditoría UNA vez por cambio de estado (sin saldo → con
//      saldo), no una vez por pedido fallido.
//   4. Les dice a los jobs que no intenten durante PAUSA_JOBS_MS desde el
//      último fallo: sin saldo, cada intento es un error seguro. Pasado ese
//      tiempo prueban de nuevo, por si ya se recargó. El chat siempre prueba:
//      es una persona pidiendo, y si funciona el estado se limpia solo.
// ─────────────────────────────────────────────────────────────────────────

export const MENSAJE_SIN_SALDO =
  'Se acabó el saldo de la cuenta de Anthropic que usa Kaizen. Hasta que se recargue, Kaizen no puede responder ni correr sus tareas automáticas. ' +
  'Quien administra esa cuenta tiene que recargar en la consola de Anthropic → Plans & Billing (conviene activar la recarga automática).';

export const PAUSA_JOBS_MS = 60 * 60 * 1000;

let sinSaldoDesde: Date | null = null;
let ultimoFallo: Date | null = null;

/** ¿Es el error de saldo agotado? Mira el status y el texto, que es lo único estable. */
export function esSinSaldo(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; message?: unknown; error?: { error?: { message?: unknown } } };
  const texto = [e.message, e.error?.error?.message].filter((t) => typeof t === 'string').join(' ');
  const statusOk = e.status === undefined || e.status === 400 || e.status === 402;
  return statusOk && /credit balance is too low|insufficient (credit|balance)|purchase credits/i.test(texto);
}

/** Registra el fallo. Devuelve el mensaje para mostrar. */
export async function marcarSinSaldo(origen: string, conversationId: string | null = null): Promise<string> {
  ultimoFallo = new Date();
  if (!sinSaldoDesde) {
    sinSaldoDesde = ultimoFallo;
    await audit
      .log({ conversationId, actor: 'system', action: 'anthropic:sin-saldo', resultSummary: `${MENSAJE_SIN_SALDO} (detectado en: ${origen})`, isError: true })
      .catch(() => {});
  }
  return MENSAJE_SIN_SALDO;
}

/** Una llamada al modelo funcionó: si veníamos sin saldo, se recargó. */
export async function marcarConSaldo(): Promise<void> {
  if (!sinSaldoDesde) return;
  const desde = sinSaldoDesde;
  sinSaldoDesde = null;
  ultimoFallo = null;
  await audit
    .log({ conversationId: null, actor: 'system', action: 'anthropic:saldo-ok', resultSummary: `El modelo vuelve a responder (sin saldo desde ${desde.toISOString()}).`, isError: false })
    .catch(() => {});
}

/** Puro, para probarlo: el motivo para no llamar, dado el último fallo. */
export function motivoDesde(fallo: Date | null, ahora = new Date()): string | null {
  if (!fallo) return null;
  if (ahora.getTime() - fallo.getTime() >= PAUSA_JOBS_MS) return null;
  return 'sin saldo en la cuenta de Anthropic (se reintenta pasada una hora del último fallo)';
}

/** Para los jobs: el motivo para no intentar ahora, o null si pueden. */
export function motivoParaNoLlamar(ahora = new Date()): string | null {
  return motivoDesde(ultimoFallo, ahora);
}

export function estadoSaldo(): { sinSaldoDesde: Date | null } {
  return { sinSaldoDesde };
}

/** Solo para tests. */
export function _reiniciarSaldo(): void {
  sinSaldoDesde = null;
  ultimoFallo = null;
}
