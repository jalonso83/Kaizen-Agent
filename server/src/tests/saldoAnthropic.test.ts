import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { esSinSaldo, motivoDesde, PAUSA_JOBS_MS, MENSAJE_SIN_SALDO } from '../services/saldoAnthropic';

// ─────────────────────────────────────────────────────────────────────────
// Saldo agotado de Anthropic (2026-10-13).
// ─────────────────────────────────────────────────────────────────────────

/** El error tal como lo devolvió la API el 12-oct (400 invalid_request_error). */
const errorReal = new Anthropic.BadRequestError(
  400,
  { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } },
  undefined,
  new Headers(),
);

test('reconoce el error real de saldo agotado', () => {
  assert.equal(esSinSaldo(errorReal), true);
  assert.equal(esSinSaldo(new Error('400 Your credit balance is too low to access the Anthropic API.')), true);
});

test('no confunde otros errores con saldo agotado', () => {
  const otro400 = new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'messages: field required' } }, undefined, new Headers());
  assert.equal(esSinSaldo(otro400), false);
  assert.equal(esSinSaldo(new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'Number of request tokens has exceeded your rate limit' } }, undefined, new Headers())), false);
  assert.equal(esSinSaldo(new Error('fetch failed')), false);
  assert.equal(esSinSaldo(null), false);
});

test('los jobs esperan una hora desde el último fallo y después vuelven a probar', () => {
  const fallo = new Date('2026-10-12T08:00:00Z');
  assert.equal(motivoDesde(null), null, 'sin fallos, se llama');
  assert.match(motivoDesde(fallo, new Date(fallo.getTime() + 10 * 60_000)) ?? '', /sin saldo/);
  assert.equal(motivoDesde(fallo, new Date(fallo.getTime() + PAUSA_JOBS_MS)), null, 'pasada la hora, prueba de nuevo por si se recargó');
});

test('el aviso dice qué hacer, en castellano', () => {
  assert.match(MENSAJE_SIN_SALDO, /Plans & Billing/);
  assert.match(MENSAJE_SIN_SALDO, /recargar/);
});
