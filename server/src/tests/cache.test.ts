import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, CACHE_AUTOMATICO } from '../agent/systemPrompt';
import { resumirCache } from '../services/usoCache';
import { catalogForPrompt } from '../agent/skills';

// ─────────────────────────────────────────────────────────────────────────
// Prompt caching (2026-10-10).
// ─────────────────────────────────────────────────────────────────────────

test('nunca más de 4 puntos de corte: los del system más el automático', () => {
  const bloques = buildSystemPrompt(undefined) as Array<{ cache_control?: { type: string; ttl?: string } }>;
  const conTono = buildSystemPrompt({ texto: 'Tono de prueba', fuente: 'cerebro', documento: 'tono.md' }) as typeof bloques;
  for (const b of [bloques, conTono]) {
    const cortes = b.filter((x) => x.cache_control).length + 1; // + CACHE_AUTOMATICO
    assert.ok(cortes <= 4, `la API da 400 con más de 4 cortes (hay ${cortes})`);
  }
});

test('el corte automático usa el mismo TTL que los del system (los de 1 h van primero o da 400)', () => {
  const bloques = buildSystemPrompt(undefined) as Array<{ cache_control?: { type: string; ttl?: string } }>;
  const ttlSystem = new Set(bloques.filter((b) => b.cache_control).map((b) => b.cache_control!.ttl ?? '5m'));
  const ttlAuto = (CACHE_AUTOMATICO as { ttl?: string }).ttl ?? '5m';
  assert.equal(CACHE_AUTOMATICO.type, 'ephemeral');
  // Un corte automático de 1 h detrás de cortes de 5 min rompe el orden.
  assert.ok(!(ttlAuto === '1h' && ttlSystem.has('5m')));
});

test('el system prompt sale idéntico en cada armado (cualquier diferencia es un caché perdido)', () => {
  assert.equal(JSON.stringify(buildSystemPrompt(undefined)), JSON.stringify(buildSystemPrompt(undefined)));
});

test('el catálogo de skills del system prompt va en orden alfabético, no en el del sistema de archivos', () => {
  const texto = JSON.stringify(buildSystemPrompt(undefined));
  for (const ambito of ['finzen', 'marketing'] as const) {
    const slugs = catalogForPrompt(ambito).split('\n').map((l) => l.replace(/^- /, '').split(' — ')[0]);
    assert.ok(slugs.length > 0, `hay skills de ${ambito}`);
    assert.deepEqual(slugs, [...slugs].sort(), `${ambito}: ${slugs.join(', ')}`);
    for (const s of slugs) assert.ok(texto.includes(s), `${s} está en el system prompt`);
  }
});

test('el <contexto> va último en el system, sin corte propio, y no toca los bloques cacheados', () => {
  const sin = buildSystemPrompt(undefined) as Array<{ text: string; cache_control?: unknown }>;
  const con = buildSystemPrompt(undefined, '<contexto>Hoy es lunes 13 de octubre de 2026 (2026-10-13).</contexto>') as typeof sin;
  assert.equal(con.length, sin.length + 1);
  assert.deepEqual(con.slice(0, sin.length), sin, 'BASE y TONO idénticos: se siguen leyendo del caché aunque cambie la fecha');
  assert.match(con.at(-1)!.text, /<contexto>/);
  assert.equal(con.at(-1)!.cache_control, undefined, 'el contexto no gasta un corte');
});

test('el contexto lleva la fecha sin hora: con hora cambiaría en cada pedido', async () => {
  const { buildContextBlock } = await import('../agent/contexto');
  const a = buildContextBlock(new Date('2026-10-13T13:00:00Z'));
  const b = buildContextBlock(new Date('2026-10-13T20:59:00Z'));
  assert.equal(a, b, 'dos pedidos del mismo día (hora RD) arman el mismo contexto');
  assert.ok(!/\d{1,2}:\d{2}/.test(a), 'sin hora');
});

test('el system prompt no lleva la fecha: invalidaría el caché en cada turno', () => {
  const texto = JSON.stringify(buildSystemPrompt(undefined));
  assert.ok(!/\b20\d\d-\d\d-\d\d\b/.test(texto), 'una fecha AAAA-MM-DD en el system prompt rompe el prefijo cacheado');
});

test('el resumen del caché: porcentaje leído y costo relativo, sin contar mensajes viejos', () => {
  const r = resumirCache([
    { inputTokens: 1000, cacheReadTokens: 8000, cacheWriteTokens: 1000 },
    { inputTokens: 500, cacheReadTokens: 9000, cacheWriteTokens: 500 },
    { inputTokens: 50_000, cacheReadTokens: null, cacheWriteTokens: null }, // anterior a la migración: no cuenta
  ]);
  assert.equal(r.respuestas, 2);
  assert.equal(r.leidos, 17_000);
  assert.equal(r.escritos, 1500);
  assert.equal(r.sinCache, 1500);
  assert.equal(r.pctLeido, 85); // 17000 / 20000
  assert.equal(r.pctCosto, 25); // (0,1×17000 + 1,25×1500 + 1500) / 20000 = 25,4 %
  const vacio = resumirCache([]);
  assert.equal(vacio.pctLeido, null);
  assert.equal(vacio.pctCosto, null);
});
