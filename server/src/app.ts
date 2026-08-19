import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import proposalsRoutes from './routes/proposals';
import configRoutes from './routes/config';
import auditRoutes from './routes/audit';
import goalsRoutes from './routes/goals';
import goalsHistoryRoutes from './routes/goalsHistory';
import { startCerebroIndexJob } from './jobs/cerebroIndex';
import { startWeeklySummaryCron } from './jobs/weeklySummary';
import { startAcquisitionExportCron } from './jobs/acquisitionExport';

// ─────────────────────────────────────────────────────────────────────────
// Kaizen server — Fase 1: /health público; /api/auth, /api/conversations y
// /api/proposals (el gate de confirmación) requieren sesión.
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
app.use('/api/proposals', proposalsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/audit', auditRoutes);
// El historial va ANTES: /history es una ruta fija y no debe caer en el
// /:id/... del gate de confirmación.
app.use('/api/goals', goalsHistoryRoutes);
app.use('/api/goals', goalsRoutes);

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

// Async a propósito (DISENO §9) — nunca bloquea ni tumba el arranque de arriba.
startCerebroIndexJob();

// Solo agenda — no corre nada al boot (DISENO §12). Lee el horario de la BD,
// así que es async; un fallo (BD caída al arrancar) no debe tumbar el server:
// se loguea y el resto de la app sigue en pie, igual que el indexador.
void startWeeklySummaryCron().catch((err) => {
  console.error('[weekly-summary] No se pudo programar el cron:', err instanceof Error ? err.message : err);
});

// Export semanal de adquisición → Drive (lunes 1am RD). Solo agenda.
startAcquisitionExportCron();
