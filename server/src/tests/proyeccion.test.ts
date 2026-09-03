import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  proyectar,
  FORMA_KPIS,
  FORMA_EVALUACION,
  FORMA_SEGMENTOS,
  FORMA_ADQUISICION,
  type Forma,
} from '../clients/proyeccion';

// ─────────────────────────────────────────────────────────────────────────
// La prueba que de verdad importa acá es la de FALSOS POSITIVOS: una lista
// blanca mal escrita borra datos legítimos y —como todo lo que se descarta—
// lo hace sin romper nada. Por eso el primer caso proyecta la respuesta REAL
// del contrato (la misma fixture del mock, tomada del PRD §4.2) y exige que
// salga idéntica, campo por campo.
// ─────────────────────────────────────────────────────────────────────────

/** Fixture del PRD §4.2 — la misma que sirve `mock/finzenApiMock.ts`. */
const KPIS_DEL_CONTRATO = {
  period: { from: '2026-06-01', to: '2026-06-30' },
  users: { total: 2100, new_registrations: 412, registration_change_pct: 12.5, activated: 205 },
  engagement: { dau: 310, wau: 640, mau: 890, retention_d1_pct: 42.1, retention_d7_pct: 31.0, retention_d30_pct: 18.2 },
  revenue: {
    mrr_usd: 1480.0,
    plan_distribution: { FREE: 1990, PREMIUM: 96, PRO: 12 },
    churn_rate_pct: 3.2,
    free_to_paid_rate_pct: 4.8,
    trials: { active: 22, started: 61, conversion_rate_pct: 23.0 },
  },
  acquisition: {
    totals: { visitors: 5400, leads: 800, registrations: 412, subscriptions: 30 },
    by_source: [
      {
        source: 'meta', campaign: 'julio_ahorro', visitors: 1200, leads: 300, registrations: 120,
        subscriptions: 9, revenue_usd: 54.0, cost_usd: 222.0, conversion_rate_pct: 10.0, cac_usd: 1.85,
      },
    ],
  },
  campaigns: [
    {
      id: 'cmp_123', title: 'Reactivación dormidos — julio', surface: 'push',
      sent_at: '2026-06-15T14:00:00Z', holdout_pct: 10, exposed: 1200, holdout: 130,
      impressions: 340, clicks: 88, exposed_tx_rate_pct: 18.4, holdout_tx_rate_pct: 12.1, lift_pts: 6.3,
    },
  ],
};

function proyectarCon(valor: unknown, forma: Forma): { limpio: unknown; descartes: string[] } {
  const descartes: string[] = [];
  const limpio = proyectar(valor, forma, '', descartes);
  return { limpio, descartes };
}

test('la respuesta real del contrato pasa entera, sin descartar nada', () => {
  const { limpio, descartes } = proyectarCon(KPIS_DEL_CONTRATO, FORMA_KPIS);
  assert.deepEqual(limpio, KPIS_DEL_CONTRATO);
  assert.deepEqual(descartes, []);
});

test('wau ausente no se inventa (es opcional en el contrato, PRD §4.2)', () => {
  const sinWau = structuredClone(KPIS_DEL_CONTRATO) as Record<string, any>;
  delete sinWau.engagement.wau;
  const { limpio, descartes } = proyectarCon(sinWau, FORMA_KPIS);
  assert.equal('wau' in (limpio as any).engagement, false);
  assert.deepEqual(descartes, []);
});

test('un campo nuevo fuera del contrato se descarta y se reporta con su ruta', () => {
  const conPii = structuredClone(KPIS_DEL_CONTRATO) as Record<string, any>;
  conPii.users.emails = ['ana@ejemplo.com', 'luis@ejemplo.com'];
  const { limpio, descartes } = proyectarCon(conPii, FORMA_KPIS);
  assert.equal('emails' in (limpio as any).users, false);
  assert.deepEqual(descartes, ['users.emails']);
});

test('un campo nuevo dentro de un arreglo también se descarta', () => {
  const conPii = structuredClone(KPIS_DEL_CONTRATO) as Record<string, any>;
  conPii.campaigns[0].recipients = [{ id: 1, email: 'ana@ejemplo.com' }];
  const { limpio, descartes } = proyectarCon(conPii, FORMA_KPIS);
  assert.equal('recipients' in (limpio as any).campaigns[0], false);
  assert.deepEqual(descartes, ['campaigns[].recipients']);
});

test('un campo declarado como escalar que llega como objeto se descarta', () => {
  const raro = structuredClone(KPIS_DEL_CONTRATO) as Record<string, any>;
  raro.revenue.mrr_usd = { valor: 1480, moneda: 'USD' };
  const { limpio, descartes } = proyectarCon(raro, FORMA_KPIS);
  assert.equal('mrr_usd' in (limpio as any).revenue, false);
  assert.deepEqual(descartes, ['revenue.mrr_usd (se esperaba un escalar)']);
});

test('plan_distribution conserva sus claves libres (es un mapa)', () => {
  const conPlanNuevo = structuredClone(KPIS_DEL_CONTRATO) as Record<string, any>;
  conPlanNuevo.revenue.plan_distribution.ENTERPRISE = 3;
  const { limpio, descartes } = proyectarCon(conPlanNuevo, FORMA_KPIS);
  assert.deepEqual((limpio as any).revenue.plan_distribution, { FREE: 1990, PREMIUM: 96, PRO: 12, ENTERPRISE: 3 });
  assert.deepEqual(descartes, []);
});

test('un mapa con un valor no escalar descarta solo esa clave', () => {
  const raro = structuredClone(KPIS_DEL_CONTRATO) as Record<string, any>;
  raro.revenue.plan_distribution.PRO = { total: 12, usuarios: ['ana'] };
  const { limpio, descartes } = proyectarCon(raro, FORMA_KPIS);
  assert.deepEqual((limpio as any).revenue.plan_distribution, { FREE: 1990, PREMIUM: 96 });
  assert.deepEqual(descartes, ['revenue.plan_distribution.PRO (se esperaba un escalar)']);
});

test('null pasa: cac_usd y campaign son nulos por contrato', () => {
  const conNulos = structuredClone(KPIS_DEL_CONTRATO) as Record<string, any>;
  conNulos.acquisition.by_source[0].cac_usd = null;
  conNulos.acquisition.by_source[0].campaign = null;
  const { limpio, descartes } = proyectarCon(conNulos, FORMA_KPIS);
  assert.equal((limpio as any).acquisition.by_source[0].cac_usd, null);
  assert.equal((limpio as any).acquisition.by_source[0].campaign, null);
  assert.deepEqual(descartes, []);
});

test('la evaluación de segmento pasa entera y descarta lo que no declara', () => {
  const evaluacion = {
    slug: 'budget_exceeded', count: 1240, opted_out: 85,
    params_used: { plans: 'FREE' }, evaluated_at: '2026-07-09T14:00:00Z',
  };
  const { limpio, descartes } = proyectarCon(evaluacion, FORMA_EVALUACION);
  assert.deepEqual(limpio, evaluacion);
  assert.deepEqual(descartes, []);

  const conIds = { ...evaluacion, user_ids: [1, 2, 3] };
  const segundo = proyectarCon(conIds, FORMA_EVALUACION);
  assert.equal('user_ids' in (segundo.limpio as any), false);
  assert.deepEqual(segundo.descartes, ['user_ids']);
});

test('el catálogo de segmentos conserva sus params anidados', () => {
  const catalogo = {
    segments: [
      {
        slug: 'budget_exceeded', name: 'Presupuesto excedido', description: 'Usuarios con presupuesto excedido.',
        params: [{ name: 'plans', type: 'csv', required: false, default: 'FREE,PREMIUM,PRO', description: 'Planes' }],
      },
    ],
  };
  const { limpio, descartes } = proyectarCon(catalogo, FORMA_SEGMENTOS);
  assert.deepEqual(limpio, catalogo);
  assert.deepEqual(descartes, []);
});

test('la ventana de adquisición pasa entera', () => {
  const ventana = {
    window: { start: '2026-08-11', end: '2026-08-17', timezone: 'America/Santo_Domingo' },
    rows: [{ source: 'Directo', campaign: null, medium: null, visitors: 120, leads: 30, leads_unicos: 24 }],
  };
  const { limpio, descartes } = proyectarCon(ventana, FORMA_ADQUISICION);
  assert.deepEqual(limpio, ventana);
  assert.deepEqual(descartes, []);
});

test('un arreglo que llega donde se esperaba un objeto se descarta, no rompe', () => {
  const { limpio, descartes } = proyectarCon({ period: [], users: { total: 1 } }, FORMA_KPIS);
  assert.deepEqual(limpio, { users: { total: 1 } });
  assert.deepEqual(descartes, ['period (se esperaba un objeto)']);
});
