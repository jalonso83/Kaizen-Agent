import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { audit } from '../services/audit';
import { runWeeklySummary } from '../jobs/weeklySummary';

// ─────────────────────────────────────────────────────────────────────────
// /api/config/weekly-summary — el apartado de Configuración pedido junto con
// el resumen semanal (DISENO_FASE1.md §12 addendum, 2026-07-22): define qué
// semana usa el cron (rolling: últimos 7 días; calendar: semana completa con
// día de inicio elegible). Fila única (id=1) — cualquier socio logueado puede
// verla y cambiarla, no hay roles distintos en Fase 1.
// ─────────────────────────────────────────────────────────────────────────

const WEEK_MODES = ['rolling', 'calendar'] as const;

const router = Router();
router.use(requireAuth);

router.get('/weekly-summary', asyncRoute(async (_req, res) => {
  const cfg = await db.weeklySummaryConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  res.json(cfg);
}));

router.put('/weekly-summary', asyncRoute(async (req, res) => {
  const weekMode = req.body?.weekMode as string | undefined;
  const weekStartDay = req.body?.weekStartDay;

  if (!weekMode || !WEEK_MODES.includes(weekMode as (typeof WEEK_MODES)[number])) {
    res.status(400).json({ message: `"weekMode" debe ser uno de: ${WEEK_MODES.join(', ')}.` });
    return;
  }
  if (
    typeof weekStartDay !== 'number' ||
    !Number.isInteger(weekStartDay) ||
    weekStartDay < 0 ||
    weekStartDay > 6
  ) {
    res.status(400).json({ message: '"weekStartDay" debe ser un entero de 0 (domingo) a 6 (sábado).' });
    return;
  }

  const updated = await db.weeklySummaryConfig.upsert({
    where: { id: 1 },
    update: { weekMode, weekStartDay, updatedBy: req.partner!.id },
    create: { id: 1, weekMode, weekStartDay, updatedBy: req.partner!.id },
  });

  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:weekly-summary-updated',
    input: { weekMode, weekStartDay },
  });

  res.json(updated);
}));

// Corrida manual — para no depender de acertarle a un lunes 8am RD exacto
// (con el server despierto en ese momento) para poder probar el resumen.
// Reusa exactamente la misma función que el cron (mismo guard anti-
// concurrencia, misma conversación interna, mismo Doc en Drive) — esto NO es
// un camino alternativo, es la misma corrida disparada a mano.
router.post('/weekly-summary/run-now', asyncRoute(async (req, res) => {
  const result = await runWeeklySummary();

  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:weekly-summary-run-now',
    resultSummary: result.ok ? `Semana ${result.from} a ${result.to}` : result.error,
    isError: !result.ok,
  });

  if (result.ok) {
    res.json(result);
    return;
  }
  res.status(result.error.includes('en curso') ? 409 : 502).json({ message: result.error });
}));

export default router;
