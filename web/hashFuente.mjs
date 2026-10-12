// ─────────────────────────────────────────────────────────────────────────
// Huella del código fuente de la web (2026-10-12).
//
// La web compilada vive commiteada en server/public, y Railway sirve eso. Si
// alguien cambia web/src y se olvida de regenerar server/public, producción
// queda con la web vieja y el servidor nuevo, sin ningún error (pasó del
// 2026-10-04 al 2026-10-11: tres commits de pantalla que nunca se vieron).
//
// Vite estampa esta huella en el index.html que compila, y una prueba del
// servidor (tests/webBuild.test.ts) la recalcula sobre web/src: si no
// coinciden, la prueba falla y dice qué correr.
//
// Los finales de línea se normalizan: git en Windows deja CRLF y en Linux LF,
// y la huella tiene que dar igual en las dos.
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('.', import.meta.url));
const ENTRADAS = ['src', 'public', 'index.html'];

function archivos(ruta) {
  const st = statSync(ruta);
  if (st.isFile()) return [ruta];
  return readdirSync(ruta)
    .sort()
    .flatMap((n) => archivos(join(ruta, n)));
}

export function hashFuenteWeb() {
  const h = createHash('sha256');
  for (const entrada of ENTRADAS) {
    for (const f of archivos(join(WEB, entrada))) {
      const nombre = relative(WEB, f).split(sep).join('/');
      const contenido = readFileSync(f);
      // Texto: sin CR. Binarios (el favicon): tal cual.
      const esTexto = /\.(tsx?|css|html|json|svg|mjs|js|txt|md)$/i.test(f);
      h.update(nombre);
      h.update(esTexto ? contenido.toString('utf8').replace(/\r\n/g, '\n') : contenido);
    }
  }
  return h.digest('hex').slice(0, 16);
}
