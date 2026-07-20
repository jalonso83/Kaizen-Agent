import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';

// ─────────────────────────────────────────────────────────────────────────
// Kaizen server — Fase 1: /health público, /api/auth (login de socios) y
// /api/conversations (CRUD + chat SSE) requieren sesión. /proposals (el gate
// de confirmación) y el static de web/dist se agregan en slices siguientes.
// ─────────────────────────────────────────────────────────────────────────

const app = express();
// Detrás del proxy de Railway (edge). Necesario para que express-rate-limit
// identifique bien la IP (via X-Forwarded-For) y para la detección de HTTPS.
// '1' = confiar solo en el primer proxy (el edge de Railway), no en cualquiera.
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    service: 'kaizen',
    agentEnabled: config.agentEnabled,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/conversations', chatRoutes);

// ─── Web de socios (build de Vite) ───
// Servida desde el MISMO Express que la API → mismo origen, sin CORS, la cookie
// httpOnly y el SSE del chat funcionan nativo (DISENO_FASE1.md §0.5). Los archivos
// se compilan en `web/` y se copian a `server/public/` (committeados).
const webDist = path.join(__dirname, '../public');
app.use(express.static(webDist));
// SPA fallback: cualquier GET que NO sea de la API devuelve index.html (para que
// el routing del cliente funcione con deep-links). El SSE es POST, no lo toca.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  res.sendFile(path.join(webDist, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`[Kaizen] Server escuchando en http://localhost:${config.port} (agente ${config.agentEnabled ? 'habilitado' : 'DESHABILITADO por kill switch'})`);
});
