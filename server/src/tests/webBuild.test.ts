import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────
// La web que sirve producción está al día con web/src (2026-10-12).
//
// server/public está commiteado y es lo que Railway sirve. Del 2026-10-04 al
// 2026-10-11 tres commits cambiaron web/src sin regenerarlo: el servidor
// estaba nuevo y la pantalla vieja (sin tarjetas de anuncio, sin la
// configuración de publicidad, sin la tarjeta del caché), sin ningún error.
// ─────────────────────────────────────────────────────────────────────────

const RAIZ = join(__dirname, '..', '..', '..');

test('server/public fue compilado desde el web/src actual', async () => {
  const html = readFileSync(join(RAIZ, 'server', 'public', 'index.html'), 'utf8');
  const estampada = /<meta name="kaizen-web-src" content="([0-9a-f]+)"/.exec(html)?.[1];
  const { hashFuenteWeb } = (await import(pathToFileURL(join(RAIZ, 'web', 'hashFuente.mjs')).href)) as { hashFuenteWeb: () => string };
  assert.ok(estampada, 'server/public/index.html no tiene la huella: se compiló con un vite.config viejo');
  assert.equal(
    estampada,
    hashFuenteWeb(),
    'web/src cambió y server/public no se regeneró: producción serviría la pantalla vieja. Corré `npm run build` en server/ y commiteá server/public.',
  );
});
