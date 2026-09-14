import express from 'express';

// ─────────────────────────────────────────────────────────────────────────
// Simulador local de la Graph API de Meta — Marketing API + Instagram.
//
// Habla lo que ya consumen clients/graphApi.ts, metaApi.ts e instagramApi.ts:
// mismos paths, mismo header `Authorization: Bearer`, misma forma de
// respuesta. Y, a propósito, las MISMAS RAREZAS que la Graph real:
//   - las métricas numéricas vienen como string ("1500.25"), no como número;
//   - los presupuestos en unidades menores (centavos);
//   - los errores llegan como `{ error: { message, code, fbtrace_id } }`, a
//     veces con HTTP 200 (business_discovery sin el campo, p. ej.);
//   - una publicación con comentarios desactivados NO trae comments_count;
//   - media_product_type falta en piezas viejas;
//   - una métrica de insights que Meta retiró rompe la llamada ENTERA del
//     grupo, no solo esa métrica.
// Un simulador más prolijo que la realidad hace que el código pase las
// pruebas y falle el día del token (lección del de agosto, que no se guardó).
//
// Uso:
//   npm run mock:graph                          # sirve en :4600
//   npm run test:graph                          # ejercita clientes y análisis contra esto
//
//   # o en tu .env, para correr el server entero contra el simulador:
//   META_API_BASE_URL=http://localhost:4600
//   META_SYSTEM_TOKEN=mock-meta-token            (ver TOKENS abajo)
//   META_AD_ACCOUNT_ID=act_123
//   INSTAGRAM_ACCOUNT_ID=17841400000000001
//
// Perfiles que "existen" (business_discovery): finzenai (la propia),
// competidor, sinpiezas, y los casos que fallan: noexiste, personal (no es
// Business/Creator) y sinperfil (200 sin el campo, que es lo peor de Graph).
// ─────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.MOCK_GRAPH_PORT) || 4600;

/**
 * Tokens aceptados y qué permisos "tiene" cada uno. Sirve para probar el
 * camino feliz y los dos fallos más probables el día real: el token sin
 * instagram_manage_insights (los insights fallan, el perfil no) y el vencido.
 */
const TOKENS: Record<string, { insights: boolean }> = {
  'mock-meta-token': { insights: true },
  'mock-sin-insights': { insights: false },
};

/** Métricas que este simulador trata como retiradas (coma-separadas). Ej.: "views" para imitar una versión vieja. */
const RETIRADAS = new Set(
  (process.env.MOCK_GRAPH_METRICAS_RETIRADAS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const AD_ACCOUNT = 'act_123';
const IG_ACCOUNT = '17841400000000001';

const app = express();
app.use(express.json());

let trace = 0;
function errorGraph(res: express.Response, status: number, code: number, message: string, subcode?: number) {
  trace++;
  res.status(status).json({
    error: {
      message,
      type: code === 190 ? 'OAuthException' : 'GraphMethodException',
      code,
      ...(subcode ? { error_subcode: subcode } : {}),
      fbtrace_id: `Amock${trace.toString().padStart(6, '0')}`,
    },
  });
}

// ── Auth: Bearer, como el cliente real ────────────────────────────────────
app.use((req, res, next) => {
  const auth = req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    errorGraph(res, 400, 104, 'An access token is required to request this resource.');
    return;
  }
  if (!TOKENS[token]) {
    errorGraph(res, 400, 190, 'Error validating access token: Session has expired on Monday, 01-Sep-26 10:00:00 PDT.', 463);
    return;
  }
  res.locals.permisos = TOKENS[token];
  next();
});

// ── Marketing API ─────────────────────────────────────────────────────────

app.get(`/${AD_ACCOUNT}`, (_req, res) => {
  res.json({ id: AD_ACCOUNT, name: 'FinZen AI (mock)', currency: 'USD', account_status: 1, timezone_name: 'America/Santo_Domingo' });
});

const CAMPANAS = [
  { id: '120210000000001', name: 'FZ | Registro | Sep', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS', daily_budget: '1500', created_time: '2026-09-01T12:00:00+0000', start_time: '2026-09-01T12:00:00+0000' },
  { id: '120210000000002', name: 'FZ | Retargeting | Ago', status: 'ACTIVE', effective_status: 'CAMPAIGN_PAUSED', objective: 'OUTCOME_TRAFFIC', lifetime_budget: '30000', created_time: '2026-08-10T12:00:00+0000', stop_time: '2026-08-31T23:59:59+0000' },
  { id: '120210000000003', name: 'Prueba creativa', status: 'PAUSED', effective_status: 'PAUSED', objective: 'OUTCOME_AWARENESS', daily_budget: '500', created_time: '2026-07-20T12:00:00+0000' },
];

app.get(`/${AD_ACCOUNT}/campaigns`, (_req, res) => {
  res.json({ data: CAMPANAS, paging: { cursors: { before: 'MAZDZD', after: 'MgZDZD' } } });
});

app.get(`/${AD_ACCOUNT}/insights`, (req, res) => {
  let since = '2026-09-01', until = '2026-09-07';
  try {
    const tr = JSON.parse(String(req.query.time_range ?? '{}'));
    since = tr.since ?? since;
    until = tr.until ?? until;
  } catch {
    errorGraph(res, 400, 100, '(#100) Invalid parameter: time_range');
    return;
  }
  // Todo string, como la real. cpm/cpc/ctr con muchos decimales.
  res.json({
    data: [
      { campaign_id: '120210000000001', campaign_name: 'FZ | Registro | Sep', spend: '87.43', impressions: '41230', clicks: '612', cpm: '2.120301', cpc: '0.142859', ctr: '1.484356', date_start: since, date_stop: until },
      { campaign_id: '120210000000002', campaign_name: 'FZ | Retargeting | Ago', spend: '12.10', impressions: '5300', clicks: '48', cpm: '2.283019', cpc: '0.252083', ctr: '0.905660', date_start: since, date_stop: until },
    ],
    paging: { cursors: { before: 'MAZDZD', after: 'MQZDZD' } },
  });
});

app.post(`/${AD_ACCOUNT}/campaigns`, (req, res) => {
  const b = req.body ?? {};
  if (b.status !== 'PAUSED') {
    // Si algún día el cliente manda otra cosa, este simulador lo hace visible.
    errorGraph(res, 400, 100, `(#100) mock: se esperaba status PAUSED y llegó ${JSON.stringify(b.status)}`);
    return;
  }
  res.json({ id: `1202199${Date.now().toString().slice(-8)}` });
});

// ── Instagram: business_discovery ─────────────────────────────────────────

interface PerfilMock {
  username: string;
  name: string;
  biography: string;
  website?: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
  piezas: number;
}

const PERFILES: Record<string, PerfilMock> = {
  finzenai: { username: 'finzenai', name: 'FinZen AI', biography: 'Tu asistente de finanzas personales con IA.\nRegistra, ajusta y entiende tu dinero en segundos.', website: 'https://finzenai.com', followers_count: 4820, follows_count: 312, media_count: 148, piezas: 148 },
  competidor: { username: 'competidor', name: 'Competidor RD', biography: 'Finanzas para todos.', followers_count: 15200, follows_count: 3900, media_count: 610, piezas: 610 },
  sinpiezas: { username: 'sinpiezas', name: 'Cuenta nueva', biography: '', followers_count: 12, follows_count: 40, media_count: 0, piezas: 0 },
};

/** Piezas deterministas: la misma cuenta devuelve siempre lo mismo (las pruebas pueden afirmar cifras). */
function piezas(p: PerfilMock, limite: number) {
  const n = Math.min(limite, p.piezas);
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const reel = i % 3 !== 1;
    const fecha = new Date(Date.UTC(2026, 8, 12 - i * 2, 15, 0, 0)); // cada 2 días hacia atrás desde el 12-sep
    const base = Math.round(p.followers_count * 0.02);
    const pieza: Record<string, unknown> = {
      id: `1800${p.followers_count}${String(i).padStart(4, '0')}`,
      like_count: i === 2 ? base * 9 : base + ((i * 37) % 23), // una viral en la muestra, para probar mediana vs promedio
      media_type: reel ? 'VIDEO' : 'CAROUSEL_ALBUM',
      permalink: `https://www.instagram.com/${reel ? 'reel' : 'p'}/MOCK${p.username}${i}/`,
      timestamp: fecha.toISOString().replace('.000Z', '+0000'),
    };
    if (i % 4 !== 3) pieza.caption = `Pieza ${i} de @${p.username}: cómo armar tu presupuesto en 3 pasos sin morir en el intento #finanzas`;
    if (i % 5 !== 4) pieza.comments_count = (i * 7) % 11; // la pieza 4, 9, 14... tiene comentarios desactivados: sin el campo
    if (i < n - 3) pieza.media_product_type = reel ? 'REELS' : 'FEED'; // las 3 más viejas no lo traen
    out.push(pieza);
  }
  return out;
}

/** Parsea `business_discovery.username(X){...,media.limit(N){...}}`. Si la sintaxis no calza, Graph responde (#100) sin decir dónde. */
function parsearBusinessDiscovery(fields: string): { usuario: string; limite: number } | null {
  const m = fields.match(/^business_discovery\.username\(([^)]+)\)\{(.+)\}$/);
  if (!m) return null;
  const lim = m[2].match(/media\.limit\((\d+)\)\{/);
  return { usuario: m[1], limite: lim ? Number(lim[1]) : 25 };
}

app.get(`/${IG_ACCOUNT}`, (req, res) => {
  const fields = String(req.query.fields ?? '');
  const bd = parsearBusinessDiscovery(fields);
  if (!bd) {
    errorGraph(res, 400, 100, '(#100) Tried accessing nonexisting field (business_discovery) on node type (IGUser)');
    return;
  }
  const u = bd.usuario.toLowerCase();
  if (u === 'noexiste') {
    errorGraph(res, 400, 100, `Unsupported get request. Object with ID '${bd.usuario}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`, 33);
    return;
  }
  if (u === 'personal') {
    errorGraph(res, 400, 100, '(#100) The username is invalid or the user is not a business account');
    return;
  }
  if (u === 'sinperfil') {
    // Lo peor de Graph: 200 sin el campo pedido. Sin chequeo explícito, el
    // cliente devolvería un perfil con todo en cero.
    res.json({ id: IG_ACCOUNT });
    return;
  }
  const p = PERFILES[u];
  if (!p) {
    errorGraph(res, 400, 100, `Unsupported get request. Object with ID '${bd.usuario}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`, 33);
    return;
  }
  res.json({
    business_discovery: {
      username: p.username,
      name: p.name,
      biography: p.biography,
      ...(p.website ? { website: p.website } : {}),
      followers_count: p.followers_count,
      follows_count: p.follows_count,
      media_count: p.media_count,
      media: { data: piezas(p, bd.limite) },
      id: `1784140000000${p.followers_count}`,
    },
    id: IG_ACCOUNT,
  });
});

// ── Instagram: insights de la cuenta propia ───────────────────────────────

const TOTALES: Record<string, number> = {
  reach: 18420, views: 61200, accounts_engaged: 1290, total_interactions: 3410, likes: 2965, comments: 37,
  saves: 310, shares: 98, profile_links_taps: 212, follows_and_unfollows: 168,
};

app.get(`/${IG_ACCOUNT}/insights`, (req, res) => {
  if (!res.locals.permisos.insights) {
    errorGraph(res, 400, 10, '(#10) Application does not have permission for this action', 2069030);
    return;
  }
  const metricas = String(req.query.metric ?? '').split(',').filter(Boolean);
  if (metricas.length === 0) {
    errorGraph(res, 400, 100, '(#100) The parameter metric is required');
    return;
  }
  const retirada = metricas.find((m) => RETIRADAS.has(m));
  if (retirada) {
    // Una sola métrica desconocida tumba TODO el grupo pedido: por eso el
    // cliente pide por grupos.
    errorGraph(res, 400, 100, `(#100) Invalid parameter: metric[?] must be one of the following values: reach, views, ... (received ${retirada})`);
    return;
  }
  const since = Number(req.query.since) || Math.floor(Date.now() / 1000) - 28 * 86400;
  const until = Number(req.query.until) || Math.floor(Date.now() / 1000);

  if (metricas.includes('follower_count')) {
    // Serie diaria, sin metric_type. Máximo 30 días.
    const values: Array<{ value: number; end_time: string }> = [];
    for (let t = since; t < until && values.length < 30; t += 86400) {
      const d = new Date((t + 86400) * 1000);
      values.push({ value: [3, 8, 12, -2, 5, 20, 7][values.length % 7], end_time: d.toISOString().replace(/\.\d{3}Z$/, '+0000') });
    }
    res.json({ data: [{ name: 'follower_count', period: 'day', values, title: 'Follower Count', description: 'Total number of new followers each day', id: `${IG_ACCOUNT}/insights/follower_count/day` }] });
    return;
  }

  if (req.query.metric_type !== 'total_value') {
    errorGraph(res, 400, 100, `(#100) The following metrics (${metricas.join(', ')}) should be specified with parameter metric_type=total_value`);
    return;
  }
  const desconocida = metricas.find((m) => !(m in TOTALES));
  if (desconocida) {
    errorGraph(res, 400, 100, `(#100) Invalid parameter: metric[?] must be one of the following values: ... (received ${desconocida})`);
    return;
  }
  res.json({
    data: metricas.map((m) => ({
      name: m,
      period: 'day',
      // Como la real: el valor viene como string aunque sea un entero.
      total_value: { value: String(TOTALES[m]) },
      title: m,
      description: 'mock',
      id: `${IG_ACCOUNT}/insights/${m}/day`,
    })),
  });
});

// ── Cualquier otra cosa ───────────────────────────────────────────────────
app.use((req, res) => {
  errorGraph(res, 400, 803, `(#803) Some of the aliases you requested do not exist: ${req.path.replace(/^\//, '')}`);
});

app.listen(PORT, () => {
  console.log(`[mock-graph] Simulador de la Graph API (Meta + Instagram) en http://localhost:${PORT}`);
  console.log(`[mock-graph] Tokens: ${Object.keys(TOKENS).join(', ')} · cuenta publicitaria ${AD_ACCOUNT} · IG ${IG_ACCOUNT}`);
  console.log(`[mock-graph] Perfiles: ${Object.keys(PERFILES).join(', ')} · fallan: noexiste, personal, sinperfil`);
  if (RETIRADAS.size) console.log(`[mock-graph] Métricas tratadas como retiradas: ${[...RETIRADAS].join(', ')}`);
});
