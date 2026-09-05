import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaTypeDeImagen, esImagen, PREFIJO_DESCRIPCION } from '../clients/vision';

// ─────────────────────────────────────────────────────────────────────────
// Lectura de imágenes del Cerebro. Acá se prueba el despacho —qué archivo se
// intenta describir y con qué media_type— que es lo que se puede probar sin
// llamar a la API. La descripción en sí necesita el modelo real.
//
// El caso que importa es el SVG: es una imagen pero también es texto, así que
// si el despacho lo mandara por la rama de texto plano se indexaría el XML del
// vector — el mismo ruido de marcado que se limpió del HTML el 2026-08-25.
// ─────────────────────────────────────────────────────────────────────────

test('los cuatro formatos que acepta la visión se mapean a su media_type', () => {
  const casos: Array<[string, string, string]> = [
    ['image/png', 'storyboard.png', 'image/png'],
    ['image/jpeg', 'foto.jpg', 'image/jpeg'],
    ['image/webp', 'pieza.webp', 'image/webp'],
    ['image/gif', 'animacion.gif', 'image/gif'],
  ];
  for (const [mime, nombre, esperado] of casos) {
    assert.equal(mediaTypeDeImagen(mime, nombre), esperado, nombre);
  }
});

test('jpg y jpeg son el mismo media_type', () => {
  assert.equal(mediaTypeDeImagen('', 'a.jpg'), 'image/jpeg');
  assert.equal(mediaTypeDeImagen('', 'a.jpeg'), 'image/jpeg');
});

test('cae a la extensión cuando Drive no manda un mime útil', () => {
  assert.equal(mediaTypeDeImagen('', 'Storyboard identidad visual.png'), 'image/png');
  assert.equal(mediaTypeDeImagen('application/octet-stream', 'captura.PNG'), 'image/png');
});

test('un mime con parámetros no rompe el mapeo', () => {
  assert.equal(mediaTypeDeImagen('image/png; charset=binary', 'x.png'), 'image/png');
});

test('las imágenes que la visión NO acepta devuelven null — se omiten, no fallan', () => {
  for (const [mime, nombre] of [
    ['image/bmp', 'viejo.bmp'],
    ['image/tiff', 'escaneo.tiff'],
    ['image/heic', 'iphone.heic'],
    ['image/svg+xml', 'logo.svg'],
  ] as Array<[string, string]>) {
    assert.equal(mediaTypeDeImagen(mime, nombre), null, nombre);
  }
});

test('lo que no es imagen no entra por este camino', () => {
  assert.equal(mediaTypeDeImagen('application/pdf', 'reporte.pdf'), null);
  assert.equal(mediaTypeDeImagen('text/markdown', 'nota.md'), null);
  assert.equal(esImagen('application/pdf', 'reporte.pdf'), false);
  assert.equal(esImagen('text/markdown', 'nota.md'), false);
});

test('un .png sin mime igual se reconoce como imagen', () => {
  assert.equal(esImagen('', 'grafico.png'), true);
  assert.equal(esImagen('application/octet-stream', 'grafico.jpeg'), true);
});

test('el SVG se reconoce como imagen para que NO lo agarre la rama de texto', () => {
  // Es imagen (no se indexa como texto) pero no tiene media_type (se omite).
  assert.equal(esImagen('image/svg+xml', 'logo.svg'), true);
  assert.equal(mediaTypeDeImagen('image/svg+xml', 'logo.svg'), null);
});

test('la descripción se marca como automática, no como el documento original', () => {
  assert.match(PREFIJO_DESCRIPCION, /Descripción automática/i);
  assert.match(PREFIJO_DESCRIPCION, /no es el documento original/i);
});
