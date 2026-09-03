import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ventanaDeclarada } from '../agent/tools/cerebro';

// ─────────────────────────────────────────────────────────────────────────
// La ventana de datos declarada en el encabezado de una nota del Cerebro.
// Existe porque la fecha de Drive dice cuándo se EDITÓ el archivo, no de
// cuándo son sus datos: el Diagnóstico de Activación (CAC acumulado abr–jul)
// y las notas de Junior (CAC marginal de julio) dan $79 y $142.88, los dos
// correctos, y sin la ventana el modelo los lee como dos mediciones de lo
// mismo separadas por tres semanas.
// ─────────────────────────────────────────────────────────────────────────

// `__dirname` y no `import.meta`: el tsconfig compila a CommonJS.
const repo = join(__dirname, '..', '..', '..');
const leer = (ruta: string) => readFileSync(join(repo, ruta), 'utf8');

test('lee la ventana del archivo real de la nota de reconciliación', () => {
  assert.equal(
    ventanaDeclarada(leer('docs/cerebro/finzen-cifras-ventanas-y-cac.md')),
    'abril–agosto 2026 (nota de reconciliación; cada cifra de abajo trae la suya)',
  );
});

test('las notas reales de Junior no declaran ventana — y no se les inventa una', () => {
  const notas = [
    'docs/recibido/2026-08-20-junior-metodo-de-lectura/cerebro/finzen-umbrales-y-decisiones.md',
    'docs/recibido/2026-08-20-junior-metodo-de-lectura/cerebro/finzen-rupturas-de-serie.md',
    'docs/recibido/2026-08-20-junior-metodo-y-conocimiento/cerebro/umbrales-vigentes-y-propuestos.md',
  ];
  for (const nota of notas) {
    assert.equal(ventanaDeclarada(leer(nota)), undefined, nota);
  }
});

test('acepta las variantes de la convención', () => {
  const casos: Array<[string, string]> = [
    ['# T\nVentana: julio 2026\n', 'julio 2026'],
    ['# T\n**Ventana de datos:** julio 2026\n', 'julio 2026'],
    ['# T\nPeriodo: Q3 2026\n', 'Q3 2026'],
    ['# T\nPeríodo: Q3 2026\n', 'Q3 2026'],
    ['# T\n- Cubre: abr-jul 2026\n', 'abr-jul 2026'],
    ['# T\nventana de datos: mayo\n', 'mayo'],
    ['# T\r\nVentana: julio 2026\r\n', 'julio 2026'],
    ['> Ventana: julio 2026\n', 'julio 2026'],
  ];
  for (const [texto, esperado] of casos) {
    assert.equal(ventanaDeclarada(texto), esperado, JSON.stringify(texto));
  }
});

test('no confunde la palabra suelta en prosa con una declaración', () => {
  assert.equal(ventanaDeclarada('La ventana de medición fue corta.\n'), undefined);
  assert.equal(ventanaDeclarada('# Solo un título\n\nTexto normal.\n'), undefined);
});

test('una declaración vacía no cuenta', () => {
  assert.equal(ventanaDeclarada('Ventana:   \n'), undefined);
});

test('solo se mira el encabezado: más abajo "Período:" suele ser contenido', () => {
  assert.equal(ventanaDeclarada(`${'x'.repeat(900)}\nVentana: julio 2026\n`), undefined);
});

test('una ventana larguísima se trunca en vez de inundar el contexto', () => {
  const larga = ventanaDeclarada(`Ventana: ${'a'.repeat(250)}\n`);
  assert.equal(larga?.length, 201); // 200 + el carácter de elipsis
});
