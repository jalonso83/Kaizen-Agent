import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInstagramProfileTool, listMarketingAccountsTool } from '../agent/tools/instagram';
import { resumirPublicaciones, calcularDelta, armarHistorico, type PuntoHistorico } from '../services/instagramAnalisis';
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

// ── Histórico ────────────────────────────────────────────────────────────

const punto = (fecha: string, seguidores: number, extra: Partial<PuntoHistorico> = {}): PuntoHistorico => ({
  fecha, seguidores, seguidos: 100, publicaciones_totales: 50, interacciones_promedio: 10, likes_mediana: 8, tasa_engagement_pct: 1, ...extra,
});

test('el delta compara contra el punto más reciente con al menos N días de antigüedad', () => {
  const serie = [
    punto('2026-09-01', 1000, { publicaciones_totales: 40, interacciones_promedio: 8, tasa_engagement_pct: 0.8 }),
    punto('2026-09-04', 1050),
    punto('2026-09-05', 1060),
    punto('2026-09-12', 1200, { publicaciones_totales: 45, interacciones_promedio: 12.5, tasa_engagement_pct: 1.04 }),
  ];
  const d7 = calcularDelta(serie, 7);
  // 09-05 está exactamente a 7 días: es el más reciente con ≥7 y gana sobre 09-04 (8) y 09-01 (11).
  assert.deepEqual(d7, { desde: '2026-09-05', dias: 7, seguidores: 140, mediana: 0, publicaciones_totales: -5, interacciones_promedio: 2.5, tasa_engagement_pct: 0.04 });
  const d30 = calcularDelta(serie, 30);
  assert.equal(d30, null, 'sin lectura de hace 30 días no se estima');
  // Con 8 no existe el exacto: el más reciente con ≥8 es 09-04, y `dias` lo dice.
  const d8 = calcularDelta(serie, 8);
  assert.equal(d8?.desde, '2026-09-04');
  assert.equal(d8?.dias, 8);
  const d11 = calcularDelta(serie, 11);
  assert.equal(d11?.desde, '2026-09-01');
  assert.equal(d11?.publicaciones_totales, 5);
});

test('con una sola lectura no hay delta, y la tasa null no rompe la resta', () => {
  assert.equal(calcularDelta([punto('2026-09-12', 10)], 7), null);
  const d = calcularDelta([punto('2026-09-01', 10, { tasa_engagement_pct: null }), punto('2026-09-12', 20)], 7);
  assert.equal(d?.seguidores, 10);
  assert.equal(d?.tasa_engagement_pct, null);
});

test('el histórico armado lleva los dos deltas y la primera lectura', () => {
  const h = armarHistorico([punto('2026-08-01', 900), punto('2026-09-12', 1000)], '2026-07-01');
  assert.equal(h.delta_7d?.seguidores, 100);
  assert.equal(h.delta_30d?.dias, 42);
  assert.equal(h.primera_lectura, '2026-07-01');
  assert.equal(h.ventana_dias, 90);
});
