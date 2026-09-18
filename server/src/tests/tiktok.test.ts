import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perfilDeTiktok, UrlTiktokInvalida } from '../util/tiktok';
import { normalizarVideos, explicarErrorTiktok, tiktokConfigurado } from '../clients/tiktokApi';
import { resumirVideos } from '../services/tiktokAnalisis';
import { getTiktokProfileTool } from '../agent/tools/tiktok';
import { TOOL_LIST, CRON_TOOL_LIST } from '../agent/tools';

// ─────────────────────────────────────────────────────────────────────────
// TikTok (2026-09-18): parseo de URLs, normalización de videos, el resumen
// calculado en código y el contrato de la tool. La lectura real contra la
// Display API queda para cuando FinZen autorice la app (Login Kit).
// ─────────────────────────────────────────────────────────────────────────

test('acepta las formas en que la gente pega un perfil de TikTok', () => {
  for (const e of ['https://www.tiktok.com/@FinZenAI', 'tiktok.com/@finzenai/', 'https://tiktok.com/@finzenai?lang=es', '@finzenai', 'finzenai']) {
    assert.deepEqual(perfilDeTiktok(e), { usuario: 'finzenai', url: 'https://www.tiktok.com/@finzenai' }, e);
  }
});

test('rechaza videos, secciones, otros hosts y usuarios inválidos, con motivo', () => {
  assert.throws(() => perfilDeTiktok('https://www.tiktok.com/@finzenai/video/7300000000000000000'), /video/);
  assert.throws(() => perfilDeTiktok('https://www.tiktok.com/explore'), /sección/);
  assert.throws(() => perfilDeTiktok('https://www.tiktok.com/finzenai'), /arroba/);
  assert.throws(() => perfilDeTiktok('https://instagram.com/finzenai'), /no de TikTok/);
  assert.throws(() => perfilDeTiktok('@a'), UrlTiktokInvalida);
  assert.throws(() => perfilDeTiktok(''), /vacío/);
});

const video = (n: Record<string, unknown>) => ({
  id: 'v', title: 'T', video_description: 'd', create_time: 1_757_000_000, share_url: 'https://www.tiktok.com/@x/video/1',
  duration: 30, view_count: 1000, like_count: 50, comment_count: 5, share_count: 10, ...n,
});

test('normaliza videos: contadores faltantes a 0, create_time en segundos → ISO', () => {
  const [v] = normalizarVideos([video({ like_count: undefined, share_count: null, create_time: 1_757_000_000 })]);
  assert.equal(v.like_count, 0);
  assert.equal(v.share_count, 0);
  assert.equal(v.view_count, 1000);
  assert.match(v.timestamp, /^2025-09-04T/);
});

test('el resumen usa la mediana de views y ordena el top por views', () => {
  const vids = normalizarVideos([
    video({ id: 'a', view_count: 800, like_count: 40, comment_count: 4, share_count: 6, create_time: 1_757_000_000 }),
    video({ id: 'b', view_count: 1200, like_count: 60, comment_count: 6, share_count: 4, create_time: 1_757_600_000 }),
    video({ id: 'c', view_count: 90_000, like_count: 5000, comment_count: 300, share_count: 900, create_time: 1_758_200_000 }), // viral
  ]);
  const r = resumirVideos(vids);
  assert.equal(r.cantidad, 3);
  assert.equal(r.views_mediana, 1200);
  assert.ok(r.views_promedio > 30_000, 'el viral dispara el promedio');
  assert.equal(r.interacciones_promedio, redondea((50 + 70 + 6200) / 3));
  assert.equal(r.top[0].views, 90_000);
  assert.equal(r.videos_por_semana, redondea((3 / (1_200_000 / 86_400)) * 7));
  assert.equal(r.desde, '2025-09-04');
  assert.equal(resumirVideos([]).views_mediana, 0);
});

function redondea(n: number) { return Math.round(n * 10) / 10; }

test('errores traducidos', () => {
  assert.match(explicarErrorTiktok('access_token_invalid', 'x'), /Login Kit/);
  assert.match(explicarErrorTiktok('scope_not_authorized', 'x'), /user.info.stats/);
  assert.match(explicarErrorTiktok('rate_limit_exceeded', 'x'), /NO reintentes/);
  assert.match(explicarErrorTiktok(null, 'raro'), /raro/);
});

test('la tool está en marketing, en el cron (solo lee) y falla legible sin credenciales', async () => {
  assert.equal(getTiktokProfileTool.ambito, 'marketing');
  assert.ok(TOOL_LIST.includes(getTiktokProfileTool));
  assert.ok(CRON_TOOL_LIST.includes(getTiktokProfileTool));
  assert.equal(tiktokConfigurado(), false);
  await assert.rejects(getTiktokProfileTool.execute({}, { conversationId: null }), /TIKTOK_CLIENT_KEY.*NO reintentes/s);
});
