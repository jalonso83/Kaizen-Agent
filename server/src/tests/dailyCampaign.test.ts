import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentosPermitidos } from '../jobs/dailyCampaign';
import { DAILY_CAMPAIGN_TOOL_LIST, CRON_TOOL_LIST, TOOL_LIST } from '../agent/tools';

// ─────────────────────────────────────────────────────────────────────────
// La campaña diaria (2026-09-20): la rotación y los candados de la corrida.
// ─────────────────────────────────────────────────────────────────────────

test('la rotación excluye los segmentos usados y, si agota el catálogo, lo devuelve entero', () => {
  const catalogo = ['a', 'b', 'c', 'd'];
  assert.deepEqual(segmentosPermitidos(catalogo, ['b', 'd']), ['a', 'c']);
  assert.deepEqual(segmentosPermitidos(catalogo, ['b', 'b', 'x']), ['a', 'c', 'd'], 'repetidos y slugs que ya no existen no rompen');
  assert.deepEqual(segmentosPermitidos(catalogo, ['a', 'b', 'c', 'd']), catalogo, 'agotado → vuelve a empezar');
  assert.deepEqual(segmentosPermitidos(catalogo, []), catalogo);
});

test('la corrida diaria puede proponer pero nunca crear el borrador ni tocar la meta', () => {
  const nombres = DAILY_CAMPAIGN_TOOL_LIST.map((t) => t.name);
  assert.ok(nombres.includes('propose_campaign'), 'sin propose_campaign no hay tarjeta');
  for (const prohibida of ['create_campaign_draft', 'propose_goal', 'mark_goal_achieved']) {
    assert.ok(!nombres.includes(prohibida), `${prohibida} no puede estar en la corrida diaria`);
  }
  // Es un superconjunto estricto del cron semanal: todo lo que lee el cron, más la tarjeta.
  for (const t of CRON_TOOL_LIST) assert.ok(DAILY_CAMPAIGN_TOOL_LIST.includes(t), `${t.name} falta`);
  assert.equal(DAILY_CAMPAIGN_TOOL_LIST.length, TOOL_LIST.length - 3);
});
