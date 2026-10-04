import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularResultado, DIAS_MINIMOS_EVALUACION } from '../services/resultadosAnuncios';
import { motivoParaNoEvaluar, recordMetaAdEvaluationTool } from '../agent/tools/publicidad';
import { AD_EVALUATION_TOOL_LIST, CRON_TOOL_LIST, DAILY_CAMPAIGN_TOOL_LIST, META_ADS_TOOL_LIST } from '../agent/tools';
import type { DiaCampana } from '../clients/metaApi';

// ─────────────────────────────────────────────────────────────────────────
// El seguimiento de los anuncios de Kaizen (2026-10-05).
// ─────────────────────────────────────────────────────────────────────────

const NOMBRE = 'kaizen-ig-20261004-gastos-hormiga';

function dias(n: number, gasto = 5, desdeDia = 5): DiaCampana[] {
  return Array.from({ length: n }, (_, i) => ({
    fecha: `2026-10-${String(desdeDia + i).padStart(2, '0')}`,
    gasto,
    impresiones: 1000,
    alcance: 800 + i * 10,
    clicsEnlace: 20,
    clics: 35,
  }));
}

const filas = [
  { source: 'meta', campaign: NOMBRE, medium: 'paid_social', visitors: 90, leads: 40, leads_unicos: 25 },
  { source: 'meta', campaign: NOMBRE, medium: null, visitors: 10, leads: 6, leads_unicos: 5 },
  { source: 'meta', campaign: 'FZ | Registro | Sep', medium: 'paid_social', visitors: 999, leads: 999, leads_unicos: 999 },
];

test('suma Meta, filtra FinZen por utm_campaign y calcula los costos en código', () => {
  const r = calcularResultado(NOMBRE, 'ACTIVE', '2026-10-04', '2026-10-12', dias(8), filas);
  assert.equal(r.gasto, 40);
  assert.equal(r.impresiones, 8000);
  assert.equal(r.clicsEnlace, 160);
  assert.equal(r.ctrPct, 2);
  assert.equal(r.costoPorClic, 0.25);
  assert.equal(r.cpm, 5);
  assert.deepEqual(r.finzen, { visitantes: 100, clicsDescarga: 30 }, 'solo las filas de esta campaña, sumando sus variantes');
  assert.equal(r.costoPorVisitante, 0.4);
  assert.equal(r.costoPorClicDescarga, 1.33);
  assert.equal(r.alcance, 870, 'el alcance es el máximo diario, no la suma');
  assert.equal(r.primerDiaConGasto, '2026-10-05');
  assert.equal(r.evaluable, true);
});

test('menos de 7 días con gasto no es evaluable; los días sin gasto no cuentan', () => {
  const r = calcularResultado(NOMBRE, 'ACTIVE', '2026-10-04', '2026-10-12', [...dias(2, 0, 3), ...dias(6, 5, 5)], filas);
  assert.equal(r.diasConGasto, 6);
  assert.equal(r.primerDiaConGasto, '2026-10-05', 'el primer día CON gasto, no el primero de la lista');
  assert.equal(r.evaluable, false);
  assert.equal(DIAS_MINIMOS_EVALUACION, 7);
});

test('sin gasto, sin clics o sin FinZen: null, nunca NaN ni división por cero', () => {
  const nunca = calcularResultado(NOMBRE, 'PAUSED', '2026-10-04', '2026-10-12', [], filas);
  assert.equal(nunca.primerDiaConGasto, null);
  assert.equal(nunca.ctrPct, null);
  assert.equal(nunca.costoPorClic, null);
  const sinFinzen = calcularResultado(NOMBRE, 'ACTIVE', '2026-10-04', '2026-10-12', dias(8), null, ['FinZen caído']);
  assert.equal(sinFinzen.finzen, null);
  assert.equal(sinFinzen.costoPorClicDescarga, null);
  assert.deepEqual(sinFinzen.avisos, ['FinZen caído']);
  const sinFilas = calcularResultado(NOMBRE, 'ACTIVE', '2026-10-04', '2026-10-12', dias(8), []);
  assert.deepEqual(sinFilas.finzen, { visitantes: 0, clicsDescarga: 0 });
  assert.equal(sinFilas.costoPorClicDescarga, null, 'cero clics a descargar: sin costo, no infinito');
});

const ahora = new Date('2026-10-13T12:00:00Z');
const evaluable = calcularResultado(NOMBRE, 'ACTIVE', '2026-10-04', '2026-10-12', dias(8), filas);
const base = { status: 'CREATED_PAUSED', evaluadaEn: null, recomendacion: null, resultado: evaluable as unknown as object, resultadoEn: new Date('2026-10-13T07:00:00Z') };

test('la evaluación tiene candados: 7 días, lectura fresca, una sola vez', () => {
  assert.equal(motivoParaNoEvaluar(base as never, ahora), null);
  assert.match(motivoParaNoEvaluar(null, ahora) ?? '', /No hay un anuncio/);
  assert.match(motivoParaNoEvaluar({ ...base, status: 'ERROR' } as never, ahora) ?? '', /No hay un anuncio/);
  const temprano = calcularResultado(NOMBRE, 'ACTIVE', '2026-10-04', '2026-10-12', dias(3), filas);
  assert.match(motivoParaNoEvaluar({ ...base, resultado: temprano } as never, ahora) ?? '', /lleva 3 día\(s\) con gasto y hacen falta 7/);
  assert.match(motivoParaNoEvaluar({ ...base, resultadoEn: new Date('2026-10-10T07:00:00Z') } as never, ahora) ?? '', /más de 48 horas/);
  assert.match(motivoParaNoEvaluar({ ...base, resultado: null, resultadoEn: null } as never, ahora) ?? '', /no tiene resultados/);
  assert.match(
    motivoParaNoEvaluar({ ...base, evaluadaEn: new Date('2026-10-12T00:00:00Z'), recomendacion: 'pausar' } as never, ahora) ?? '',
    /ya tiene una recomendación \(pausar/,
  );
});

test('la recomendación es una de tres y no hay forma de pedirle a la tool que pause en Meta', () => {
  const props = (recordMetaAdEvaluationTool.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
  assert.deepEqual(Object.keys(props).sort(), ['ad_id', 'razon', 'recomendacion']);
  assert.deepEqual(props.recomendacion.enum, ['seguir', 'pausar', 'cambiar_post']);
});

test('quién puede leer resultados y quién registrar la recomendación', () => {
  const n = (l: typeof CRON_TOOL_LIST) => l.map((t) => t.name);
  assert.ok(n(CRON_TOOL_LIST).includes('get_meta_ad_results'), 'el resumen semanal los lee');
  assert.ok(!n(CRON_TOOL_LIST).includes('record_meta_ad_evaluation'), 'pero no recomienda');
  assert.ok(!n(DAILY_CAMPAIGN_TOOL_LIST).includes('record_meta_ad_evaluation'));
  assert.ok(n(META_ADS_TOOL_LIST).includes('get_meta_ad_results'), 'la próxima propuesta aprende de los anteriores');
  assert.ok(!n(META_ADS_TOOL_LIST).includes('record_meta_ad_evaluation'));
  const ev = n(AD_EVALUATION_TOOL_LIST);
  assert.ok(ev.includes('record_meta_ad_evaluation') && ev.includes('get_meta_ad_results'));
  for (const prohibida of ['propose_meta_ad', 'propose_campaign', 'create_campaign_draft', 'propose_goal', 'save_cerebro_note']) {
    assert.ok(!ev.includes(prohibida), `${prohibida} no puede estar en la evaluación`);
  }
});
