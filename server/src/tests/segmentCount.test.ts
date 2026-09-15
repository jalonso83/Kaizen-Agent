import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraerEvaluaciones } from '../agent/tools/campaigns';

// ─────────────────────────────────────────────────────────────────────────
// Backstop de la regla dura 1: el segment_count de una propuesta tiene que
// venir de un evaluate_segment real de la misma conversación.
//
// Acá se prueba la parte pura —leer la evidencia del audit log—; la decisión
// de aceptar o rechazar vive en verificarSegmentCount, que necesita BD.
// ─────────────────────────────────────────────────────────────────────────

const fila = (input: unknown, resultSummary: string | null) => ({ input, resultSummary });

test('lee slug y count de una evaluación real', () => {
  const filas = [
    fila(
      { slug: 'budget_exceeded', plans: 'FREE' },
      JSON.stringify({ slug: 'budget_exceeded', count: 1240, opted_out: 85, params_used: { plans: 'FREE' } }),
    ),
  ];
  assert.deepEqual(extraerEvaluaciones(filas), [
    { slug: 'budget_exceeded', count: 1240, params: { slug: 'budget_exceeded', plans: 'FREE' } },
  ]);
});

test('el slug sale del RESULTADO, no del input — el resultado es lo que FinZen respondió', () => {
  const filas = [
    fila({ slug: 'lo_que_pidio_el_modelo' }, JSON.stringify({ slug: 'dormant', count: 300 })),
  ];
  assert.equal(extraerEvaluaciones(filas)[0].slug, 'dormant');
});

test('count 0 es evidencia válida (un segmento vacío es un dato real)', () => {
  const filas = [fila({ slug: 'trial_ending' }, JSON.stringify({ slug: 'trial_ending', count: 0 }))];
  assert.deepEqual(extraerEvaluaciones(filas), [
    { slug: 'trial_ending', count: 0, params: { slug: 'trial_ending' } },
  ]);
});

test('una fila que no es JSON se ignora en vez de romper', () => {
  const filas = [
    fila({ slug: 'dormant' }, 'El segmento "dormant" no existe en el catálogo.'),
    fila({ slug: 'active' }, JSON.stringify({ slug: 'active', count: 51 })),
  ];
  assert.deepEqual(extraerEvaluaciones(filas), [
    { slug: 'active', count: 51, params: { slug: 'active' } },
  ]);
});

test('un JSON truncado (resultSummary corta en 2000 chars) se ignora, no cuenta como evidencia', () => {
  const filas = [fila({ slug: 'dormant' }, '{"slug":"dormant","cou')];
  assert.deepEqual(extraerEvaluaciones(filas), []);
});

test('un count que no es número no cuenta como evidencia', () => {
  const filas = [
    fila({ slug: 'dormant' }, JSON.stringify({ slug: 'dormant', count: '1240' })),
    fila({ slug: 'dormant' }, JSON.stringify({ slug: 'dormant', count: null })),
    fila({ slug: 'dormant' }, JSON.stringify({ slug: 'dormant' })),
  ];
  assert.deepEqual(extraerEvaluaciones(filas), []);
});

test('resultSummary vacío o nulo no rompe', () => {
  assert.deepEqual(extraerEvaluaciones([fila({}, null), fila({}, '')]), []);
});

test('varias evaluaciones del mismo slug conviven — proponer sobre cualquiera es legítimo', () => {
  const filas = [
    fila({ slug: 'dormant', days: 30 }, JSON.stringify({ slug: 'dormant', count: 2527 })),
    fila({ slug: 'dormant', days: 14 }, JSON.stringify({ slug: 'dormant', count: 900 })),
  ];
  const evaluaciones = extraerEvaluaciones(filas);
  assert.equal(evaluaciones.length, 2);
  assert.deepEqual(
    evaluaciones.map((e) => e.count).sort((a, b) => a - b),
    [900, 2527],
  );
});

test('input ausente o no-objeto deja params vacío sin perder la evidencia', () => {
  const filas = [fila(null, JSON.stringify({ slug: 'active', count: 70 }))];
  assert.deepEqual(extraerEvaluaciones(filas), [{ slug: 'active', count: 70, params: {} }]);
});

test('la nota de solape viaja con cada evaluación (los counts no se suman entre segmentos)', async () => {
  const { SOLAPE_NOTE } = await import('../agent/tools/segments');
  assert.match(SOLAPE_NOTE, /SE SOLAPAN/);
  assert.match(SOLAPE_NOTE, /NUNCA sumes/);
  assert.match(SOLAPE_NOTE, /push alcanzable/);
});

test('el backstop sigue leyendo la evaluación aunque el resultado lleve la nota de solape adelante', async () => {
  const { SOLAPE_NOTE } = await import('../agent/tools/segments');
  const filas = [
    { input: { slug: 'near_paywall' }, resultSummary: `${SOLAPE_NOTE}\n${JSON.stringify({ slug: 'near_paywall', count: 648, opted_out: 19 })}` },
    { input: { slug: 'dormant', days: 14 }, resultSummary: JSON.stringify({ slug: 'dormant', count: 579 }) }, // formato viejo, sin nota
    { input: { slug: 'x' }, resultSummary: 'OJO: sin json' },
  ];
  const ev = extraerEvaluaciones(filas);
  assert.deepEqual(ev.map((e) => [e.slug, e.count]), [['near_paywall', 648], ['dormant', 579]]);
});
