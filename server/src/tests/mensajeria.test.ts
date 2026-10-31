import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTREGA_MINIMA_PCT, esLegible, leerCampana, margenUsuarios, totalPeriodo, type Campana } from '../services/lecturaCampanas';
import { OBJETIVOS, validateProposalInput, violacionReglasFijas } from '../agent/tools/campaigns';
import { segmentosPermitidos } from '../jobs/dailyCampaign';
import { expresionCron } from '../services/publicidad';

// ─────────────────────────────────────────────────────────────────────────
// Plan de mensajería interna (2026-10-26): la lectura de campañas en código y
// las reglas fijas de propose_campaign.
// ─────────────────────────────────────────────────────────────────────────

const campana = (c: Partial<Campana> = {}): Campana => ({
  id: 'c1', title: 't', surface: 'push', sent_at: '2026-10-01T12:00:00Z', holdout_pct: 20,
  exposed: 1000, holdout: 250, impressions: 900, clicks: 10,
  exposed_tx_rate_pct: 5, holdout_tx_rate_pct: 5, lift_pts: 0,
  ...c,
});
const DESPUES = new Date('2026-10-20T00:00:00Z');

test('sin entrega no se lee: ni "sin efecto" ni "funcionó"', () => {
  const l = leerCampana(campana({ impressions: 0, lift_pts: 4 }), DESPUES);
  assert.equal(l.veredicto, 'no_medible_entrega');
  assert.equal(l.entrega_pct, 0);
  assert.ok(!esLegible(l));
  assert.match(l.lectura, /No medible/);
  // Justo en el corte cuenta como entregada; un poco menos, no.
  assert.equal(leerCampana(campana({ impressions: ENTREGA_MINIMA_PCT * 10 }), DESPUES).veredicto !== 'no_medible_entrega', true);
  assert.equal(leerCampana(campana({ impressions: ENTREGA_MINIMA_PCT * 10 - 1 }), DESPUES).veredicto, 'no_medible_entrega');
  // Si FinZen no manda impresiones, falta el dato: no se dice "0 %".
  const sinDato = leerCampana(campana({ impressions: undefined as unknown as number }), DESPUES);
  assert.equal(sinDato.veredicto, 'no_medible_entrega');
  assert.equal(sinDato.entrega_pct, null);
  assert.match(sinDato.lectura, /no informó impresiones/);
});

test('con la ventana abierta no se concluye; cierra a los 7 días del envío', () => {
  const abierta = leerCampana(campana(), new Date('2026-10-05T00:00:00Z'));
  assert.equal(abierta.veredicto, 'ventana_abierta');
  assert.equal(abierta.ventana_cierra, '2026-10-08');
  assert.equal(leerCampana(campana(), new Date('2026-10-08T12:00:00Z')).ventana_cerrada, true);
});

test('el margen usa la tasa real: 1.000 expuestos y 250 de control al 5 % dan ±30 usuarios, no ±69', () => {
  // 1,96 × √(0,05 × 0,95 × (1/1000 + 1/250)) × 1000 ≈ 30,2
  assert.equal(margenUsuarios(campana()), 30);
  // Con p = 50 % (el error del análisis anterior) daría ≈ 69: más del doble.
  assert.equal(margenUsuarios(campana({ exposed_tx_rate_pct: 50, holdout_tx_rate_pct: 50 })), 69);
  // Sin control no hay margen.
  assert.equal(margenUsuarios(campana({ holdout: 0 })), null);
  // Nadie transaccionó en ningún brazo: no se presenta un margen de 0.
  assert.ok((margenUsuarios(campana({ exposed_tx_rate_pct: 0, holdout_tx_rate_pct: 0 })) ?? 0) > 0);
});

test('un efecto dentro del margen es indistinguible; fuera, positivo o negativo', () => {
  assert.equal(leerCampana(campana({ lift_pts: 2 }), DESPUES).veredicto, 'indistinguible'); // +20 ± 30
  const pos = leerCampana(campana({ lift_pts: 4, exposed_tx_rate_pct: 7 }), DESPUES); // +40
  assert.equal(pos.veredicto, 'positivo');
  assert.equal(pos.usuarios_incrementales, 40);
  assert.equal(leerCampana(campana({ lift_pts: -5 }), DESPUES).veredicto, 'negativo');
  assert.equal(leerCampana(campana({ holdout: 0 }), DESPUES).veredicto, 'sin_control');
});

test('el total del período suma solo las legibles, con el margen como raíz de la suma de cuadrados', () => {
  const ls = [
    leerCampana(campana({ lift_pts: 2 }), DESPUES), // +20 ± 30
    leerCampana(campana({ lift_pts: -1 }), DESPUES), // −10 ± 30
    leerCampana(campana({ impressions: 0, lift_pts: 9 }), DESPUES), // no medible: no suma
  ];
  const t = totalPeriodo(ls);
  assert.equal(t.campanas_legibles, 2);
  assert.equal(t.usuarios_incrementales, 10);
  assert.equal(t.margen_usuarios, 42); // √(30² + 30²)
  assert.equal(totalPeriodo([]).margen_usuarios, null);
});

const propuesta = (extra: Record<string, unknown> = {}) => ({
  title: 'Tu semana en un toque', message: 'Revisa cómo vas y anota lo de hoy.', segment_slug: 'one_and_done',
  rationale: 'one_and_done tiene 202 usuarios con una sola transacción', expected_measurement: '% que vuelve a transaccionar en 14 días',
  message_type: 'pregunta_directa', objetivo: 'reactivacion', segment_count: 202, holdout_pct: 20, ...extra,
});

test('propose_campaign: nunca a never_activated, nunca sin control, siempre con objetivo', () => {
  assert.equal(validateProposalInput(propuesta()).objetivo, 'reactivacion');
  assert.throws(() => validateProposalInput(propuesta({ segment_slug: 'never_activated' })), /never_activated/);
  assert.throws(() => validateProposalInput(propuesta({ holdout_pct: 0 })), /grupo de control/);
  assert.throws(() => validateProposalInput(propuesta({ objetivo: undefined })), /"objetivo" es requerido/);
  assert.throws(() => validateProposalInput(propuesta({ objetivo: 'urgencia' })), /"objetivo"/, 'el enfoque del copy no es un objetivo');
  // Omitir el holdout deja el default de la API (10 %): eso sí tiene control.
  assert.equal(validateProposalInput(propuesta({ holdout_pct: undefined })).campaignInput.holdout_pct, undefined);
  // El objetivo no viaja a FinZen: el payload sigue siendo el contrato del borrador.
  assert.ok(!('objetivo' in validateProposalInput(propuesta()).campaignInput));
  for (const o of Object.values(OBJETIVOS)) assert.ok(o.metrica && o.ventana && o.api);
});

test('la campaña diaria nunca ofrece never_activated, ni cuando la rotación reabre el catálogo', () => {
  const catalogo = ['never_activated', 'dormant', 'one_and_done'];
  assert.deepEqual(segmentosPermitidos(catalogo, []), ['dormant', 'one_and_done']);
  assert.deepEqual(segmentosPermitidos(catalogo, ['dormant', 'one_and_done']), ['dormant', 'one_and_done']);
});

test('la campaña diaria corre solo los días elegidos', () => {
  assert.equal(expresionCron(9, [5, 1, 3, 3]), '0 9 * * 1,3,5');
});

test('datos rotos de FinZen no tumban la lectura: se marcan sin_datos', () => {
  const sinFecha = leerCampana(campana({ sent_at: 'no-es-fecha' }), DESPUES);
  assert.equal(sinFecha.veredicto, 'sin_datos');
  assert.equal(sinFecha.ventana_cierra, null);
  const sinTasas = leerCampana(campana({ exposed_tx_rate_pct: undefined as unknown as number }), DESPUES);
  assert.equal(sinTasas.veredicto, 'sin_datos', 'con control pero sin tasas no es "sin control"');
  const sinLift = leerCampana(campana({ lift_pts: undefined as unknown as number }), DESPUES);
  assert.equal(sinLift.veredicto, 'sin_datos');
  assert.ok(![sinFecha, sinTasas, sinLift].some(esLegible));
});

test('las reglas fijas: control de menos de 1 % no cuenta, y los nombres heredados no son vetos', () => {
  assert.throws(() => validateProposalInput(propuesta({ holdout_pct: 0.5 })), /al menos 1/);
  assert.equal(violacionReglasFijas({ segment_slug: 'constructor', holdout_pct: 20 }), null);
  assert.equal(violacionReglasFijas({ segment_slug: 'toString', holdout_pct: undefined }), null);
  assert.deepEqual(segmentosPermitidos(['toString', 'never_activated'], []), ['toString']);
  // Una tarjeta vieja, propuesta antes del plan, se frena al crear el borrador.
  assert.match(violacionReglasFijas({ segment_slug: 'never_activated', holdout_pct: 10 }) ?? '', /never_activated/);
  assert.match(violacionReglasFijas({ segment_slug: 'dormant', holdout_pct: 0 }) ?? '', /grupo de control/);
});
