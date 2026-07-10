import express from 'express';
import { config } from './config';

// ─────────────────────────────────────────────────────────────────────────
// Kaizen server — Fase 0: esqueleto con /health.
// Fase 1 agrega: /auth (login socios), /chat (SSE con el agente),
// /proposals, y el orquestador del loop de Claude en src/agent/.
// ─────────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    service: 'kaizen',
    agentEnabled: config.agentEnabled,
    timestamp: new Date().toISOString(),
  });
});

app.listen(config.port, () => {
  console.log(`[Kaizen] Server escuchando en http://localhost:${config.port} (agente ${config.agentEnabled ? 'habilitado' : 'DESHABILITADO por kill switch'})`);
});
