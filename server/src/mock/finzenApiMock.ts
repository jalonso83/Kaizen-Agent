import express from 'express';

// ─────────────────────────────────────────────────────────────────────────
// Mock local de la FinZen Agent API — habla el MISMO contrato que ya usa
// clients/finzenApi.ts (PRD §4): mismos paths, mismo header x-agent-key,
// misma forma de respuesta. No es una interfaz inventada — el "users.total"/
// "activated"/"trials.active" de acá son el ejemplo que el propio PRD §4.2
// documenta como respuesta real, y `budget_exceeded` (count 1240, opted_out
// 85) es exactamente el ejemplo de PRD §4.3.
//
// Sirve para probar get_kpis, get_campaign_results, list_segments y
// evaluate_segment SIN necesitar la key real de FinZen ni tocar producción.
// No reemplaza probar contra la API real antes de confiar en el agente.
//
// Uso:
//   npm run mock:finzen                         # sirve en :4500
//   # en tu .env: FINZEN_API_URL=http://localhost:4500
//   #             FINZEN_AGENT_KEY=mock-local-key   (o lo que pongas en MOCK_FINZEN_KEY)
// ─────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.MOCK_FINZEN_PORT) || 4500;
const EXPECTED_KEY = process.env.MOCK_FINZEN_KEY || 'mock-local-key';

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  if (req.header('x-agent-key') !== EXPECTED_KEY) {
    res.status(401).json({ message: 'x-agent-key inválida o ausente (mock).' });
    return;
  }
  next();
});

// ── KPIs — forma y valores del ejemplo real de PRD_Kaizen.md §4.2 ──────────
app.get('/api/agent/kpis', (req, res) => {
  const from = (req.query.from as string) || '2026-06-01';
  const to = (req.query.to as string) || '2026-06-30';
  res.json({
    period: { from, to },
    users: { total: 2100, new_registrations: 412, registration_change_pct: 12.5, activated: 205 },
    engagement: { dau: 310, mau: 890, retention_d1_pct: 42.1, retention_d7_pct: 31.0, retention_d30_pct: 18.2 },
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
          source: 'meta',
          campaign: 'julio_ahorro',
          visitors: 1200,
          leads: 300,
          registrations: 120,
          subscriptions: 9,
          revenue_usd: 54.0,
          cost_usd: 222.0,
          conversion_rate_pct: 10.0,
          cac_usd: 1.85,
        },
      ],
    },
    campaigns: [
      {
        id: 'cmp_123',
        title: 'Reactivación dormidos — julio',
        surface: 'push',
        sent_at: '2026-06-15T14:00:00Z',
        holdout_pct: 10,
        exposed: 1200,
        holdout: 130,
        impressions: 340,
        clicks: 88,
        exposed_tx_rate_pct: 18.4,
        holdout_tx_rate_pct: 12.1,
        lift_pts: 6.3,
      },
    ],
  });
});

// ── Segmentos — catálogo con los 5 slugs reales del contrato (PRD §4.3) ────
const SEGMENTS = [
  {
    slug: 'never_activated',
    name: 'Nunca activó',
    description: 'Usuarios registrados que nunca completaron su primera transacción.',
    count: 1450,
    opted_out: 38,
    params: [
      { name: 'plans', type: 'csv', required: false, default: 'FREE,PREMIUM,PRO', description: 'CSV de planes' },
      { name: 'platforms', type: 'csv', required: false, default: 'IOS,ANDROID', description: 'CSV de plataformas' },
      { name: 'country', type: 'string', required: false, description: 'País exacto' },
    ],
  },
  {
    slug: 'dormant',
    name: 'Dormido',
    description: 'Con al menos una transacción histórica, sin actividad en la ventana de días.',
    count: 320,
    opted_out: 12,
    params: [
      { name: 'plans', type: 'csv', required: false, default: 'FREE,PREMIUM,PRO', description: 'CSV de planes' },
      { name: 'platforms', type: 'csv', required: false, default: 'IOS,ANDROID', description: 'CSV de plataformas' },
      { name: 'country', type: 'string', required: false, description: 'País exacto' },
      { name: 'days', type: 'int', required: false, default: 14, description: 'Ventana de inactividad en días' },
    ],
  },
  {
    slug: 'active',
    name: 'Activo',
    description: 'Transacciones recientes y recurrentes dentro de la ventana de días.',
    count: 205,
    opted_out: 3,
    params: [
      { name: 'plans', type: 'csv', required: false, default: 'FREE,PREMIUM,PRO', description: 'CSV de planes' },
      { name: 'platforms', type: 'csv', required: false, default: 'IOS,ANDROID', description: 'CSV de plataformas' },
      { name: 'country', type: 'string', required: false, description: 'País exacto' },
      { name: 'days', type: 'int', required: false, default: 14, description: 'Ventana de actividad en días' },
    ],
  },
  {
    slug: 'budget_exceeded',
    name: 'Presupuesto excedido',
    description: 'Usuarios con al menos un presupuesto vigente cuyo gasto superó el monto.',
    count: 1240,
    opted_out: 85,
    params: [
      { name: 'plans', type: 'csv', required: false, default: 'FREE,PREMIUM,PRO', description: 'CSV de planes' },
      { name: 'platforms', type: 'csv', required: false, default: 'IOS,ANDROID', description: 'CSV de plataformas' },
      { name: 'country', type: 'string', required: false, description: 'País exacto' },
    ],
  },
  {
    slug: 'trial_ending',
    name: 'Trial por vencer',
    description: 'Trials activos a N días de vencer sin haber decidido plan.',
    count: 22,
    opted_out: 1,
    params: [
      { name: 'plans', type: 'csv', required: false, default: 'PREMIUM,PRO', description: 'CSV de planes en trial' },
      { name: 'platforms', type: 'csv', required: false, default: 'IOS,ANDROID', description: 'CSV de plataformas' },
      { name: 'country', type: 'string', required: false, description: 'País exacto' },
      { name: 'days', type: 'int', required: false, default: 3, description: 'Días al vencimiento del trial' },
    ],
  },
];

app.get('/api/agent/segments', (_req, res) => {
  res.json({ segments: SEGMENTS.map(({ slug, name, description, params }) => ({ slug, name, description, params })) });
});

app.get('/api/agent/segments/:slug', (req, res) => {
  const segment = SEGMENTS.find((s) => s.slug === req.params.slug);
  if (!segment) {
    res.status(404).json({
      message: `Slug inexistente: ${req.params.slug}`,
      available_slugs: SEGMENTS.map((s) => s.slug),
    });
    return;
  }
  res.json({
    slug: segment.slug,
    count: segment.count,
    opted_out: segment.opted_out,
    params_used: req.query,
    evaluated_at: new Date().toISOString(),
  });
});

// ── Campañas — borrador (PENDING_APPROVAL), para cuando exista propose_campaign/create_campaign_draft ──
app.post('/api/agent/campaigns', (req, res) => {
  const { title, message, segment_slug, rationale } = req.body ?? {};
  if (typeof title !== 'string' || title.length === 0 || title.length > 100) {
    res.status(422).json({ message: 'title inválido (requerido, ≤100 chars).' });
    return;
  }
  if (typeof message !== 'string' || message.length === 0 || message.length > 200) {
    res.status(422).json({ message: 'message inválido (requerido, ≤200 chars).' });
    return;
  }
  if (typeof rationale !== 'string' || rationale.length < 10) {
    res.status(422).json({ message: 'rationale inválido (requerido, ≥10 chars).' });
    return;
  }
  if (!SEGMENTS.some((s) => s.slug === segment_slug)) {
    res.status(422).json({ message: `segment_slug inexistente: ${segment_slug}` });
    return;
  }
  res.status(201).json({
    id: `mock_${Math.random().toString(36).slice(2, 10)}`,
    status: 'PENDING_APPROVAL',
    message: 'Borrador creado (mock) — pendiente de aprobación humana.',
  });
});

app.listen(PORT, () => {
  console.log(`[mock-finzen] sirviendo en http://localhost:${PORT} (x-agent-key esperada: "${EXPECTED_KEY}")`);
});
