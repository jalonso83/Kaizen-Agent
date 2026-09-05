import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraerTexto, SinTextoError, FORMATOS_SOPORTADOS } from '../clients/documentos';

// ─────────────────────────────────────────────────────────────────────────
// El despacho de `extraerTexto`: qué rama agarra cada archivo. Prueba el
// cableado real del módulo, no una copia de la lógica.
//
// `setup.ts` deja la lectura de imágenes APAGADA, así que una imagen legible
// devuelve null (omitida) sin llamar a la API. Eso es justo lo que se quiere
// verificar acá: que apagarla no rompe nada y que el archivo no se cuela por
// la rama equivocada.
// ─────────────────────────────────────────────────────────────────────────

/** PNG de 1×1 real (el header IHDR importa: no es un buffer cualquiera). */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('un PNG no se indexa como texto: sale por la rama de imagen', async () => {
  // Con la visión apagada devuelve null (omitida). Lo que NO puede pasar es que
  // devuelva texto: sería el binario del PNG entrando al índice.
  assert.equal(await extraerTexto(PNG_1x1, 'image/png', 'grafico.png'), null);
});

test('un SVG tampoco entra como texto, aunque técnicamente lo sea', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>hola</text></svg>', 'utf8');
  // Sin este caso, la rama de EXT_TEXTO lo indexaría con todo el XML del vector.
  assert.equal(await extraerTexto(svg, 'image/svg+xml', 'logo.svg'), null);
});

test('el markdown sigue entrando por la rama de texto', async () => {
  const md = Buffer.from('# Nota\n\nContenido de prueba con suficiente largo para pasar.', 'utf8');
  const r = await extraerTexto(md, 'text/markdown', 'nota.md');
  assert.ok(r);
  assert.match(r.texto, /Contenido de prueba/);
});

test('un HTML se limpia y no trae el marcado', async () => {
  const html = Buffer.from(
    '<html><head><style>.a{color:red}</style></head><body><p>Texto real del reporte de agosto</p></body></html>',
    'utf8',
  );
  const r = await extraerTexto(html, 'text/html', 'reporte.html');
  assert.ok(r);
  assert.match(r.texto, /Texto real del reporte/);
  assert.doesNotMatch(r.texto, /color:red|<p>/);
});

test('un formato viejo de Office falla visible, con instrucción de qué hacer', async () => {
  await assert.rejects(
    () => extraerTexto(Buffer.from('binario viejo'), 'application/msword', 'informe.doc'),
    (err: unknown) => {
      assert.ok(err instanceof SinTextoError);
      assert.match(err.message, /\.docx|documento de Google/i);
      return true;
    },
  );
});

test('un tipo que de verdad no se lee devuelve null, no lanza', async () => {
  assert.equal(await extraerTexto(Buffer.from('\x00\x01'), 'video/mp4', 'clip.mp4'), null);
  assert.equal(await extraerTexto(Buffer.from('\x00\x01'), 'audio/mpeg', 'nota.mp3'), null);
});

test('el aviso de formatos soportados menciona las imágenes y aclara que no es OCR', () => {
  assert.match(FORMATOS_SOPORTADOS, /imágenes/i);
  assert.match(FORMATOS_SOPORTADOS, /no es OCR/i);
});
