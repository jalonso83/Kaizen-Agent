import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quedoSinRespuesta } from '../agent/history';

// ─────────────────────────────────────────────────────────────────────────
// Reintentar cuando Kaizen no llegó a responder (2026-10-15).
// ─────────────────────────────────────────────────────────────────────────

const texto = (t: string) => [{ type: 'text', text: t }];

test('el mensaje del socio sin respuesta se puede reintentar', () => {
  assert.equal(quedoSinRespuesta({ role: 'user', content: texto('¿cómo vamos esta semana?') }), true);
});

test('un turno cortado a mitad (último: resultados de tools) también', () => {
  assert.equal(quedoSinRespuesta({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] }), true);
});

test('si Kaizen ya respondió, no', () => {
  assert.equal(quedoSinRespuesta({ role: 'assistant', content: texto('Esta semana…') }), false);
  assert.equal(quedoSinRespuesta(undefined), false, 'conversación vacía');
});

test('un evento del sistema solo (confirmar o rechazar una tarjeta) no espera respuesta', () => {
  assert.equal(quedoSinRespuesta({ role: 'user', content: texto('<evento_sistema>El socio RECHAZÓ la propuesta x.</evento_sistema>') }), false);
  // Pero un mensaje del socio que además trae un evento, sí.
  assert.equal(quedoSinRespuesta({ role: 'user', content: [...texto('<evento_sistema>x</evento_sistema>'), ...texto('y ahora qué?')] }), true);
});
