import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construirCampoBusinessDiscovery,
  normalizarPublicaciones,
  instagramConfigurado,
} from '../clients/instagramApi';
import { numeroGraph, explicarErrorGraph } from '../clients/graphApi';

// ─────────────────────────────────────────────────────────────────────────
// Cliente de Instagram. Acá se prueba lo que no necesita red: armar la
// consulta y normalizar la respuesta. La llamada real necesita el token y el
// id de cuenta, que este entorno no tiene.
//
// Las dos cosas que se prueban son las dos donde un error no se ve:
//
//  - La sintaxis anidada de business_discovery. Si le falta una coma o un
//    paréntesis, Graph contesta con un error genérico de parámetros que no
//    dice dónde está el problema.
//  - La normalización. Un contador ausente sin default se convierte en NaN y
//    viaja en silencio hasta un reporte que dice "NaN likes".
// ─────────────────────────────────────────────────────────────────────────

test('la consulta de business_discovery queda bien formada', () => {
  const campo = construirCampoBusinessDiscovery('finzenai', 25);

  // Estructura: business_discovery.username(X){ ... media.limit(N){ ... } }
  assert.match(campo, /^business_discovery\.username\(finzenai\)\{/);
  assert.match(campo, /media\.limit\(25\)\{/);
  assert.ok(campo.endsWith('}}'), `debería cerrar los dos bloques: ${campo}`);

  // Paréntesis y llaves balanceados: es el error más fácil de cometer.
  const cuenta = (s: string, c: string) => [...s].filter((x) => x === c).length;
  assert.equal(cuenta(campo, '{'), cuenta(campo, '}'), 'llaves desbalanceadas');
  assert.equal(cuenta(campo, '('), cuenta(campo, ')'), 'paréntesis desbalanceados');
});

test('la consulta pide los campos que hacen falta y no otros', () => {
  const campo = construirCampoBusinessDiscovery('finzenai', 10);
  for (const esperado of [
    'username',
    'followers_count',
    'follows_count',
    'media_count',
    'like_count',
    'comments_count',
    'media_type',
    'permalink',
    'timestamp',
  ]) {
    assert.ok(campo.includes(esperado), `falta el campo ${esperado}`);
  }
  // Alcance, impresiones y guardados NO se piden acá: business_discovery no
  // los da. Pedirlos haría fallar la consulta entera.
  for (const noVa of ['reach', 'impressions', 'saved']) {
    assert.ok(!campo.includes(noVa), `no debería pedir ${noVa}: business_discovery no lo da`);
  }
});

test('el límite de publicaciones viaja en la consulta', () => {
  assert.match(construirCampoBusinessDiscovery('x', 1), /media\.limit\(1\)/);
  assert.match(construirCampoBusinessDiscovery('x', 50), /media\.limit\(50\)/);
});

test('normaliza una publicación completa', () => {
  const [p] = normalizarPublicaciones([
    {
      id: '17900000000000000',
      caption: 'Tu primer minuto en FinZen',
      like_count: 42,
      comments_count: 7,
      media_type: 'VIDEO',
      media_product_type: 'REELS',
      permalink: 'https://www.instagram.com/reel/ABC123/',
      timestamp: '2026-09-01T14:00:00+0000',
    },
  ]);

  assert.equal(p.like_count, 42);
  assert.equal(p.comments_count, 7);
  assert.equal(p.media_product_type, 'REELS');
  assert.equal(p.caption, 'Tu primer minuto en FinZen');
});

test('un contador ausente da 0, NUNCA NaN', () => {
  // Pasa de verdad: una publicación con los comentarios desactivados no trae
  // comments_count. Sin default, eso es NaN y viaja hasta el reporte.
  const [p] = normalizarPublicaciones([{ id: '1', like_count: 10 }]);
  assert.equal(p.comments_count, 0);
  assert.ok(!Number.isNaN(p.comments_count));
  assert.ok(!Number.isNaN(p.like_count));
});

test('una publicación sin texto no rompe ni inventa', () => {
  const [p] = normalizarPublicaciones([{ id: '1', media_type: 'IMAGE' }]);
  assert.equal(p.caption, '');
  assert.equal(p.media_product_type, null);
  assert.equal(p.permalink, '');
});

test('media_type ausente queda como UNKNOWN y no como cadena vacía', () => {
  // Una cadena vacía se lee como "no tiene tipo"; UNKNOWN se lee como "no
  // sabemos", que es lo que de verdad pasó.
  const [p] = normalizarPublicaciones([{ id: '1' }]);
  assert.equal(p.media_type, 'UNKNOWN');
});

test('una lista vacía devuelve una lista vacía', () => {
  assert.deepEqual(normalizarPublicaciones([]), []);
});

test('numeroGraph aguanta lo que Graph manda de verdad', () => {
  // Graph devuelve los números como string en varios nodos.
  assert.equal(numeroGraph('42'), 42);
  assert.equal(numeroGraph(42), 42);
  assert.equal(numeroGraph('3.5'), 3.5);
  assert.equal(numeroGraph(null), 0);
  assert.equal(numeroGraph(undefined), 0);
  assert.equal(numeroGraph(''), 0);
  assert.equal(numeroGraph('no es un número'), 0);
  assert.equal(numeroGraph(undefined, -1), -1);
});

test('los errores de Graph que cambian la acción se traducen', () => {
  // Token vencido, límite por volumen y permiso faltante se arreglan de tres
  // formas distintas: el mensaje tiene que dejar claro cuál es.
  assert.match(explicarErrorGraph(190, 'expired'), /regenerar META_SYSTEM_TOKEN/);
  assert.match(explicarErrorGraph(4, 'too many calls'), /No reintentar en bucle/);
  assert.match(explicarErrorGraph(200, 'no perms'), /instagram_basic/);
  assert.match(explicarErrorGraph(110, 'nope'), /no existe/);
  // Un código desconocido pasa el mensaje crudo: mejor eso que una
  // traducción equivocada.
  assert.equal(explicarErrorGraph(999999, 'algo raro'), 'algo raro');
  assert.equal(explicarErrorGraph(null, 'algo raro'), 'algo raro');
});

test('sin INSTAGRAM_ACCOUNT_ID se reporta como no configurado', () => {
  // setup.ts no define ni el token ni el id, así que acá tiene que dar false.
  assert.equal(instagramConfigurado(), false);
});
