import express from 'express';

// ─────────────────────────────────────────────────────────────────────────
// Simulador local de la TikTok Display API v2 (2026-09-18). Habla lo que
// consume clients/tiktokApi.ts con las rarezas reales: los errores vienen en
// el cuerpo con code "ok" cuando NO hay error; el refresh token ROTA en cada
// renovación (el anterior deja de valer); los videos pagina de a 20 con
// cursor; create_time en segundos; un video sin título.
//
// Uso:
//   npm run mock:tiktok                         # :4700
//   # .env:  TIKTOK_API_BASE_URL=http://localhost:4700
//   #        TIKTOK_CLIENT_KEY=mock  TIKTOK_CLIENT_SECRET=mock
//   #        TIKTOK_REFRESH_TOKEN=rt-0            (rota a rt-1, rt-2… en cada refresh)
// Tokens que fallan: TIKTOK_REFRESH_TOKEN=vencido → invalid_grant.
// ─────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.MOCK_TIKTOK_PORT) || 4700;
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

let generacion = 0;
const accessValidos = new Set<string>();

app.post('/oauth/token/', (req, res) => {
  const { client_key, client_secret, grant_type, refresh_token } = req.body ?? {};
  if (client_key !== 'mock' || client_secret !== 'mock') {
    res.status(400).json({ error: 'invalid_client', error_description: 'Client key or secret is incorrect.' });
    return;
  }
  if (grant_type === 'authorization_code') {
    // El Login Kit: cualquier code que empiece con "code-" vale una vez.
    if (!/^code-/.test(String(req.body?.code)) || !req.body?.redirect_uri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired.' });
      return;
    }
    generacion++;
    const at = `at-${generacion}-${Date.now()}`;
    accessValidos.add(at);
    res.json({ access_token: at, expires_in: 86400, refresh_token: `rt-${generacion}`, refresh_expires_in: 31536000, open_id: 'open-finzen', scope: 'user.info.basic,user.info.profile,user.info.stats,video.list', token_type: 'Bearer' });
    return;
  }
  if (grant_type !== 'refresh_token' || refresh_token === 'vencido' || !/^rt-\d+$/.test(String(refresh_token))) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.' });
    return;
  }
  // Solo la generación vigente sirve: rt-0 la primera vez, después la que se devolvió.
  const n = Number(String(refresh_token).slice(3));
  if (n !== generacion) {
    res.status(400).json({ error: 'invalid_grant', error_description: `Refresh token rt-${n} was rotated; current is rt-${generacion}.` });
    return;
  }
  generacion++;
  const at = `at-${generacion}-${Date.now()}`;
  accessValidos.add(at);
  res.json({ access_token: at, expires_in: 86400, refresh_token: `rt-${generacion}`, refresh_expires_in: 31536000, open_id: 'open-finzen', scope: 'user.info.basic,user.info.profile,user.info.stats,video.list', token_type: 'Bearer' });
});

app.use((req, res, next) => {
  const t = (req.header('authorization') ?? '').replace(/^Bearer /, '');
  if (!accessValidos.has(t)) {
    res.status(401).json({ error: { code: 'access_token_invalid', message: 'The access token is invalid or not found in the request.', log_id: 'mock' } });
    return;
  }
  next();
});

app.get('/user/info/', (_req, res) => {
  res.json({
    data: { user: { open_id: 'open-finzen', display_name: 'FinZen AI', username: 'finzenai', bio_description: 'Tu asistente de finanzas con IA', profile_deep_link: 'https://www.tiktok.com/@finzenai', is_verified: false, follower_count: 1830, following_count: 41, likes_count: 22400, video_count: 57 } },
    error: { code: 'ok', message: '', log_id: 'mock' },
  });
});

const VIDEOS = Array.from({ length: 57 }, (_, i) => ({
  id: `73${String(i).padStart(17, '0')}`,
  ...(i % 6 === 5 ? {} : { title: `Video ${i}: 3 gastos hormiga que no ves` }),
  video_description: `#finanzas #ahorro video ${i}`,
  create_time: Math.floor(Date.UTC(2026, 8, 17, 15) / 1000) - i * 3 * 86400,
  share_url: `https://www.tiktok.com/@finzenai/video/73${String(i).padStart(17, '0')}`,
  duration: 20 + (i % 5) * 8,
  view_count: i === 3 ? 148000 : 900 + ((i * 131) % 2400),
  like_count: i === 3 ? 9800 : 40 + ((i * 17) % 160),
  comment_count: (i * 3) % 14,
  share_count: i === 3 ? 1200 : (i * 5) % 30,
}));

app.post('/video/list/', (req, res) => {
  const max = Math.min(Number(req.body?.max_count) || 10, 20);
  const cursor = Number(req.body?.cursor) || 0;
  const desde = VIDEOS.findIndex((v) => v.create_time * 1000 < cursor);
  const inicio = cursor ? (desde === -1 ? VIDEOS.length : desde) : 0;
  const pagina = VIDEOS.slice(inicio, inicio + max);
  const ultimo = pagina[pagina.length - 1];
  res.json({
    data: { videos: pagina, cursor: ultimo ? ultimo.create_time * 1000 : 0, has_more: inicio + max < VIDEOS.length },
    error: { code: 'ok', message: '', log_id: 'mock' },
  });
});

app.listen(PORT, () => console.log(`[mock-tiktok] Simulador de la Display API en http://localhost:${PORT} · refresh inicial rt-0 (rota)`));
