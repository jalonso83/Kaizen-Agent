import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInstagramProfileTool, listMarketingAccountsTool } from '../agent/tools/instagram';
import { resumirPublicaciones } from '../services/instagramAnalisis';
import type { PublicacionInstagram } from '../clients/instagramApi';
import { TOOL_LIST, CRON_TOOL_LIST } from '../agent/tools';

// ─────────────────────────────────────────────────────────────────────────
// get_instagram_profile / list_marketing_accounts (2026-09-11).
//
// Lo que se puede probar sin red ni BD: el resumen calculado en código (que
// es donde una cifra mal promediada se vuelve un reporte falso) y el
// contrato de las tools (ámbito, presencia, mensaje cuando no está
// configurado). La lectura real contra Graph queda para cuando FinZen cargue
// META_SYSTEM_TOKEN e INSTAGRAM_ACCOUNT_ID en Railway.
// ─────────────────────────────────────────────────────────────────────────

const pub = (n: Partial<PublicacionInstagram>): PublicacionInstagram => ({
  id: 'x',
  caption: '',
  like_count: 0,
  comments_count: 0,
  media_type: 'IMAGE',
  media_product_type: null,
  permalink: '',
  timestamp: '2026-09-01T12:00:00+0000',
  ...n,
});

test('el resumen promedia, saca la mediana, cuenta interacciones y agrupa por tipo', () => {
  const r = resumirPublicaciones([
    pub({ id: 'a', like_count: 10, comments_count: 1, media_product_type: 'REELS', media_type: 'VIDEO', timestamp: '2026-08-01T00:00:00+0000' }),
    pub({ id: 'b', like_count: 20, comments_count: 3, media_product_type: 'REELS', media_type: 'VIDEO', timestamp: '2026-08-15T00:00:00+0000' }),
    pub({ id: 'c', like_count: 300, comments_count: 2, media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', timestamp: '2026-09-01T00:00:00+0000' }),
  ]);
  assert.equal(r.cantidad, 3);
  assert.equal(r.likes_promedio, 110);
  // Con una pieza viral (300) el promedio (110) miente; la mediana (20) es la lectura honesta.
  assert.equal(r.likes_mediana, 20);
  assert.equal(r.comentarios_promedio, 2);
  assert.equal(r.interacciones_total, 336);
  assert.equal(r.interacciones_promedio, 112);
  assert.deepEqual(r.por_tipo, [
    { tipo: 'REELS', cantidad: 2, likes_promedio: 15, interacciones_promedio: 17 },
    { tipo: 'FEED', cantidad: 1, likes_promedio: 300, interacciones_promedio: 302 },
  ]);
  assert.equal(r.desde, '2026-08-01');
  assert.equal(r.hasta, '2026-09-01');
  // 3 piezas en 31 días ≈ 0.7 por semana.
  assert.equal(r.piezas_por_semana, 0.7);
});

test('el top 3 va por interacciones (likes + comentarios) y recorta el caption', () => {
  const r = resumirPublicaciones([
    pub({ id: 'a', like_count: 1, permalink: 'p1' }),
    pub({ id: 'b', like_count: 5, permalink: 'p2', caption: 'Hola\n\n  mundo   ' + 'x'.repeat(200) }),
    // 3 likes + 3 comentarios = 6 interacciones: pasa por encima de p4 (4+0).
    pub({ id: 'c', like_count: 3, comments_count: 3, permalink: 'p3' }),
    pub({ id: 'd', like_count: 4, permalink: 'p4' }),
  ]);
  assert.deepEqual(r.top.map((t) => t.permalink), ['p3', 'p2', 'p4']);
  assert.equal(r.top[1].caption_inicio.length, 80);
  assert.ok(r.top[1].caption_inicio.startsWith('Hola mundo'));
  assert.equal(r.piezas_por_semana, null, 'todas el mismo día: no hay ritmo que medir');
});

test('sin publicaciones el resumen es cero, no NaN', () => {
  const r = resumirPublicaciones([]);
  assert.equal(r.likes_promedio, 0);
  assert.equal(r.likes_mediana, 0);
  assert.equal(r.desde, null);
  assert.equal(r.piezas_por_semana, null);
});

test('las dos tools están registradas en el ámbito marketing y disponibles para el cron (solo leen)', () => {
  for (const t of [getInstagramProfileTool, listMarketingAccountsTool]) {
    assert.equal(t.ambito, 'marketing');
    assert.ok(TOOL_LIST.includes(t), `${t.name} no está en TOOL_LIST`);
    assert.ok(CRON_TOOL_LIST.includes(t), `${t.name} debería estar en el cron: no escribe nada`);
  }
});

test('sin credenciales, get_instagram_profile falla visible y sin tocar la BD', async () => {
  // setup.ts no define META_SYSTEM_TOKEN ni INSTAGRAM_ACCOUNT_ID.
  await assert.rejects(
    getInstagramProfileTool.execute({}, { conversationId: null }),
    /INSTAGRAM_ACCOUNT_ID.*NO reintentes/s,
  );
});
