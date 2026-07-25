import { existsSync, rmSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Copia web/dist (ya construido por Vite) a server/public — DISENO_FASE1.md
// §0.5/§10: Express sirve la web desde el MISMO origen que la API, sin CORS.
//
// Por qué existe este script: Railway tiene "Root Directory" = server (ver
// ESTADO.md), así que "npm run build" ahí adentro NUNCA tocaba web/ — el
// build de producción committeado en server/public quedaba desactualizado
// cada vez que se tocaba el frontend (bug real, encontrado 2026-07-24).
// Este script se corre COMO PARTE de `npm run build` (ver package.json) para
// que "npm install && npm run build" en server/ arme también el frontend.
//
// Se borra server/public entero antes de copiar — así no quedan assets
// hasheados viejos (Vite les pone un hash al nombre en cada build) sueltos
// para siempre.
// ─────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, '..', '..', 'web', 'dist');
const serverPublic = join(here, '..', 'public');

if (!existsSync(webDist)) {
  console.error(`[copyWebDist] No existe ${webDist} — ¿corriste "npm run build" en web/ primero?`);
  process.exit(1);
}

rmSync(serverPublic, { recursive: true, force: true });
cpSync(webDist, serverPublic, { recursive: true });

console.log(`[copyWebDist] Copiado ${webDist} -> ${serverPublic}`);
