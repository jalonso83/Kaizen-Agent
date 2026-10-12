import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { hashFuenteWeb } from './hashFuente.mjs';

// ─────────────────────────────────────────────────────────────────────────
// Dev local: el proxy hace que /api/* se vea same-origin desde el navegador
// (sin CORS, cookie httpOnly funciona normal) — el mismo principio de "cero
// CORS" que DISENO_FASE1.md §0.5 aplica al build de producción (Express
// sirviendo web/dist), solo que acá lo resuelve Vite en desarrollo.
// ─────────────────────────────────────────────────────────────────────────

// Estampa la huella de web/src en el index.html compilado (ver hashFuente.mjs).
const huellaFuente = (): Plugin => ({
  name: 'kaizen-huella-fuente',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'kaizen-web-src', content: hashFuenteWeb() }, injectTo: 'head' }],
});

export default defineConfig({
  plugins: [react(), huellaFuente()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
