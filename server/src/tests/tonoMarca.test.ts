import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TONO_FALLBACK } from '../agent/tonoFallback';
import { buildSystemPrompt } from '../agent/systemPrompt';
import { FOLDERS } from '../agent/tools/cerebro';

// ─────────────────────────────────────────────────────────────────────────
// El tono de marca y el circuito de conceptos de contenido.
//
// Contexto (auditoría de Drive, 2026-09-05): en `00-nucleo` no hay ningún
// documento de tono, así que `getTonoDeMarca()` devolvía undefined SIEMPRE y la
// regla dura 10 —no redactar sin la guía— dejaba a Kaizen sin poder escribir
// copy. El respaldo del repo cierra ese hueco sin esperar a que nadie suba nada.
// ─────────────────────────────────────────────────────────────────────────

const skill = readFileSync(
  join(__dirname, '..', '..', 'skills', 'conceptos-contenido', 'SKILL.md'),
  'utf8',
);

test('el respaldo trae lo que hace falta para redactar', () => {
  // Sin estas cuatro cosas no se puede escribir una pieza correcta: registro,
  // los dos arquetipos (la regla que más define el tono) y la audiencia.
  assert.match(TONO_FALLBACK, /dominicano/i);
  assert.match(TONO_FALLBACK, /El Sabio/);
  assert.match(TONO_FALLBACK, /El Everyman/);
  assert.match(TONO_FALLBACK, /Gen Z/i);
});

test('el respaldo no rompe las prohibiciones que él mismo declara (regla dura 15)', () => {
  // "democratizar" está vetada por el Manual de Marca. Si apareciera acá, el
  // prompt le estaría dando al modelo justo la palabra que tiene prohibida.
  assert.doesNotMatch(TONO_FALLBACK, /democratiz/i);
});

test('el respaldo cabe en el prompt sin costar una fortuna por turno', () => {
  // Va en CADA turno, incluso cuando el socio solo pregunta por KPIs. Si crece
  // sin control, lo que corresponde es moverlo al Cerebro, no engordarlo acá.
  assert.ok(
    TONO_FALLBACK.length < 6_000,
    `El respaldo de tono creció a ${TONO_FALLBACK.length} caracteres; el tope de cordura es 6.000.`,
  );
});

test('el prompt dice que el tono viene del Cerebro cuando viene del Cerebro', () => {
  const bloques = buildSystemPrompt({ texto: 'TONO REAL', fuente: 'cerebro', documento: 'tono-y-marca.md' });
  const tono = bloques[1].text;
  assert.match(tono, /del Cerebro: tono-y-marca\.md/);
  assert.match(tono, /TONO REAL/);
  assert.doesNotMatch(tono, /respaldo del repo/);
});

test('con el respaldo, el prompt lo dice Y autoriza a redactar igual', () => {
  const tono = buildSystemPrompt({ texto: TONO_FALLBACK, fuente: 'repo' })[1].text;
  assert.match(tono, /respaldo del repo/i);
  // Lo que evita el bloqueo: sin esta frase el modelo puede leer "respaldo" como
  // "incompleto" y negarse igual, que es el comportamiento que estamos quitando.
  assert.match(tono, /Alcanza para redactar/i);
  assert.match(tono, /ni te niegues a escribir/i);
});

test('sin tono, el prompt sigue diciendo que no está disponible', () => {
  const tono = buildSystemPrompt(undefined)[1].text;
  assert.match(tono, /No disponible/i);
});

test('la regla 10 ya no le prohíbe escribir cuando el tono está cargado', () => {
  const base = buildSystemPrompt({ texto: TONO_FALLBACK, fuente: 'repo' })[0].text;
  const regla10 = base.split('\n').find((l) => l.startsWith('10.'));
  assert.ok(regla10, 'no se encontró la regla 10');
  assert.match(regla10, /ya la tienes|úsala y redacta/i);
});

// ── El circuito a Contenidos ──────────────────────────────────────────────

test('el skill manda guardar en Contenidos y prohíbe el Cerebro para piezas', () => {
  assert.match(skill, /save_content_draft/);
  assert.match(skill, /Nunca guardes un concepto de contenido en el Cerebro/i);
});

test('las subcarpetas que nombra el skill existen de verdad en la tool', () => {
  // Prueba de deriva: si alguien cambia el enum de FOLDERS, el skill queda
  // mandando a una carpeta que la tool rechaza y el fallo aparece recién en una
  // conversación real, con el concepto ya escrito.
  const nombradas = [...skill.matchAll(/^\| .+ \| `([a-z]+)` \|$/gm)]
    .map((m) => m[1])
    // La fila de encabezado también dice `folder` entre backticks.
    .filter((c) => c !== 'folder');
  assert.ok(nombradas.length >= 4, `el skill debería nombrar las 4 subcarpetas, encontró ${nombradas.length}`);
  for (const carpeta of nombradas) {
    assert.ok(FOLDERS.includes(carpeta as never), `el skill manda a "${carpeta}", que no está en FOLDERS`);
  }
});

test('el skill ya no exige buscar el tono antes de redactar', () => {
  const seccion0 = skill.slice(skill.indexOf('## 0.'), skill.indexOf('## 1.'));
  assert.match(seccion0, /El tono ya lo tienes/i);
  assert.doesNotMatch(seccion0, /sin la guía de tono cargada no redactes/i);
});

test('el skill mantiene la estructura estándar del Doc (criterio 4 de Fase 2)', () => {
  for (const encabezado of ['## Gancho', '## Desarrollo', '## CTA', '## Notas de producción']) {
    assert.ok(skill.includes(encabezado), `falta "${encabezado}" en la estructura de entrega`);
  }
});
