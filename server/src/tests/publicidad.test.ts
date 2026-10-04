import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expresionCron,
  nombreCampana,
  segmentacionEfectiva,
  slugCorto,
  urlConUtm,
  validarConfigPublicidad,
  vencida,
  verificarPost,
  CADUCIDAD_HORAS,
} from '../services/publicidad';
import { proposeMetaAdTool } from '../agent/tools/publicidad';
import { CRON_TOOL_LIST, DAILY_CAMPAIGN_TOOL_LIST, META_ADS_TOOL_LIST, TOOL_LIST } from '../agent/tools';
import { crearAnuncioIgEnPausa } from '../clients/metaApi';
import { PERMISOS, puede } from '../auth/permisos';
import type { PublicacionInstagram } from '../clients/instagramApi';

// ─────────────────────────────────────────────────────────────────────────
// La publicidad automática en Meta (2026-10-04): los candados de código.
// ─────────────────────────────────────────────────────────────────────────

const valida = {
  enabled: true,
  diasSemana: [1, 4],
  cronHour: 9,
  presupuestoDiario: 5,
  duracionDias: 7,
  objetivo: 'OUTCOME_TRAFFIC',
  urlDestino: 'https://finzen.ai/',
  paises: ['DO'],
  edadMin: 18,
  edadMax: 45,
  categoriaFinanciera: false,
  rotacionDias: 30,
};

test('la configuración válida pasa', () => {
  assert.equal(validarConfigPublicidad(valida, 20), null);
});

test('el presupuesto no puede superar el tope de Railway ni ser cero', () => {
  assert.match(validarConfigPublicidad({ ...valida, presupuestoDiario: 21 }, 20) ?? '', /supera el tope de 20/);
  assert.match(validarConfigPublicidad({ ...valida, presupuestoDiario: 0 }, 20) ?? '', /mayor que cero/);
  assert.match(validarConfigPublicidad({ ...valida, presupuestoDiario: '5' }, 20) ?? '', /número/);
});

test('la duración tiene tope (acota el gasto total) y el tráfico exige una URL https', () => {
  assert.match(validarConfigPublicidad({ ...valida, duracionDias: 31 }, 20) ?? '', /1 a 30/);
  assert.match(validarConfigPublicidad({ ...valida, urlDestino: null }, 20) ?? '', /URL de destino/);
  assert.match(validarConfigPublicidad({ ...valida, urlDestino: 'http://finzen.ai' }, 20) ?? '', /https/);
  assert.equal(validarConfigPublicidad({ ...valida, objetivo: 'OUTCOME_ENGAGEMENT', urlDestino: null }, 20), null, 'interacción no lleva link');
  assert.match(validarConfigPublicidad({ ...valida, objetivo: 'OUTCOME_SALES' }, 20) ?? '', /objetivo/);
});

test('días, países y edades se validan', () => {
  assert.match(validarConfigPublicidad({ ...valida, diasSemana: [] }, 20) ?? '', /diasSemana/);
  assert.match(validarConfigPublicidad({ ...valida, diasSemana: [7] }, 20) ?? '', /diasSemana/);
  assert.match(validarConfigPublicidad({ ...valida, paises: ['do'] }, 20) ?? '', /ISO/);
  assert.match(validarConfigPublicidad({ ...valida, edadMin: 16 }, 20) ?? '', /18 a 65/);
  assert.match(validarConfigPublicidad({ ...valida, edadMin: 40, edadMax: 30 }, 20) ?? '', /mínima/);
});

test('con categoría financiera, la edad queda en 18-65 aunque la config diga otra cosa', () => {
  const s = segmentacionEfectiva({ paises: ['DO'], edadMin: 25, edadMax: 40, categoriaFinanciera: true });
  assert.deepEqual(s, { paises: ['DO'], edadMin: 18, edadMax: 65, categoriaFinanciera: true });
  assert.equal(segmentacionEfectiva({ paises: ['DO'], edadMin: 25, edadMax: 40, categoriaFinanciera: false }).edadMin, 25);
});

test('el nombre de la campaña es el utm_campaign', () => {
  assert.equal(slugCorto('¡Gastos HORMIGA en 3 pasos!'), 'gastos-hormiga-en-3-pasos');
  assert.equal(slugCorto('!!!'), 'post');
  const nombre = nombreCampana('2026-10-04', 'Gastos hormiga');
  assert.equal(nombre, 'kaizen-ig-20261004-gastos-hormiga');
  const url = new URL(urlConUtm('https://finzen.ai/descarga?ref=x', nombre));
  assert.equal(url.searchParams.get('utm_campaign'), nombre);
  assert.equal(url.searchParams.get('utm_source'), 'meta');
  assert.equal(url.searchParams.get('ref'), 'x', 'conserva los parámetros que ya tenía');
});

test('la expresión cron usa los días elegidos, sin repetir y ordenados', () => {
  assert.equal(expresionCron(9, [4, 1, 4]), '0 9 * * 1,4');
  assert.equal(expresionCron(18, [0, 1, 2, 3, 4, 5, 6]), '0 18 * * 0,1,2,3,4,5,6');
});

const pub = (id: string): PublicacionInstagram =>
  ({ id, caption: 'x', like_count: 10, comments_count: 1, media_type: 'VIDEO', media_product_type: 'REELS', permalink: `https://instagram.com/p/${id}`, timestamp: '2026-10-01T00:00:00+0000' }) as unknown as PublicacionInstagram;

test('solo se promociona un post propio, y no el mismo dos veces en la ventana', () => {
  const pubs = [pub('111'), pub('222')];
  assert.equal(verificarPost('222', pubs, [], 30).id, '222');
  assert.throws(() => verificarPost('999', pubs, [], 30), /no está entre las publicaciones/);
  assert.throws(() => verificarPost('111', pubs, ['111'], 30), /últimos 30 días/);
});

test('una tarjeta vieja ya no se puede confirmar', () => {
  const ahora = new Date('2026-10-04T12:00:00Z');
  assert.equal(vencida(new Date(ahora.getTime() - (CADUCIDAD_HORAS - 1) * 3_600_000), ahora), false);
  assert.equal(vencida(new Date(ahora.getTime() - (CADUCIDAD_HORAS + 1) * 3_600_000), ahora), true);
});

test('el modelo no tiene dónde escribir presupuesto, duración, objetivo, destino ni segmentación', () => {
  const props = Object.keys((proposeMetaAdTool.inputSchema as { properties: Record<string, unknown> }).properties);
  assert.deepEqual(props.sort(), ['media_id', 'medicion', 'nombre_corto', 'racional']);
});

test('quién puede usar propose_meta_ad', () => {
  const nombres = (l: typeof TOOL_LIST) => l.map((t) => t.name);
  assert.ok(nombres(TOOL_LIST).includes('propose_meta_ad'), 'en el chat, sí');
  assert.ok(!nombres(CRON_TOOL_LIST).includes('propose_meta_ad'), 'el resumen semanal no propone anuncios');
  assert.ok(!nombres(DAILY_CAMPAIGN_TOOL_LIST).includes('propose_meta_ad'), 'la campaña diaria de push tampoco');
  const pub = nombres(META_ADS_TOOL_LIST);
  assert.ok(pub.includes('propose_meta_ad') && pub.includes('get_instagram_profile') && pub.includes('search_cerebro'));
  for (const prohibida of ['propose_campaign', 'create_campaign_draft', 'propose_goal', 'mark_goal_achieved', 'save_cerebro_note']) {
    assert.ok(!pub.includes(prohibida), `${prohibida} no puede estar en la corrida de publicidad`);
  }
});

test('confirmar un anuncio es un permiso propio, y solo lo tiene ADMIN', () => {
  assert.ok((PERMISOS as readonly string[]).includes('publicidad:confirmar'));
  assert.equal(puede('ADMIN', 'publicidad:confirmar'), true);
  assert.equal(puede('ASSISTANT', 'publicidad:confirmar'), false);
  assert.equal(puede('USER', 'publicidad:confirmar'), false);
});

test('sin META_WRITE_ENABLED no sale ni un POST a Meta', async () => {
  await assert.rejects(
    crearAnuncioIgEnPausa({
      nombre: 'x', objetivo: 'OUTCOME_AWARENESS', presupuestoDiarioUsd: 1, inicio: new Date(), fin: new Date(Date.now() + 86_400_000),
      paises: ['DO'], edadMin: 18, edadMax: 65, categoriaFinanciera: false, mediaId: '1', urlDestino: null,
    }),
    /deshabilitada/,
  );
});
