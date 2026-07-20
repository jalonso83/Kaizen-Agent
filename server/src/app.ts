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

app.listen(config.port, () => {
  console.log(`[Kaizen] Server escuchando en http://localhost:${config.port} (agente ${config.agentEnabled ? 'habilitado' : 'DESHABILITADO por kill switch'})`);
});
