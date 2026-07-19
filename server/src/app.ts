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
