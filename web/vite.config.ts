import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ─────────────────────────────────────────────────────────────────────────
// Dev local: el proxy hace que /api/* se vea same-origin desde el navegador
// (sin CORS, cookie httpOnly funciona normal) — el mismo principio de "cero
// CORS" que DISENO_FASE1.md §0.5 aplica al build de producción (Express
// sirviendo web/dist), solo que acá lo resuelve Vite en desarrollo.
// ─────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react()],
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
