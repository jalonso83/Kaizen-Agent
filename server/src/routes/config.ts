import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { audit } from '../services/audit';
import { runWeeklySummary, startWeeklySummaryCron } from '../jobs/weeklySummary';
import { runCerebroIndex } from '../jobs/cerebroIndex';

// ─────────────────────────────────────────────────────────────────────────
// /api/config/weekly-summary — el apartado de Configuración pedido junto con
// el resumen semanal (DISENO_FASE1.md §12 addendum, 2026-07-22). Define dos
// cosas independientes:
//  - QUÉ semana se reporta: weekMode (rolling: últimos 7 días; calendar:
//    semana completa) + weekStartDay.
//  - CUÁNDO corre: cronDay + cronHour (hora de RD). Antes era fijo en código.
// Fila única (id=1) — cualquier socio logueado puede verla y cambiarla, no hay
// roles distintos en Fase 1.
// ─────────────────────────────────────────────────────────────────────────

const WEEK_MODES = ['rolling', 'calendar'] as const;

/** Valida un entero dentro de un rango; devuelve el mensaje de error o null. */
function invalidInt(value: unknown, min: number, max: number, campo: string, ayuda: string): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return `"${campo}" debe ser un entero de ${min} a ${max} (${ayuda}).`;
  }
  return null;
}

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
  const cronDay = req.body?.cronDay;
  const cronHour = req.body?.cronHour;

  if (!weekMode || !WEEK_MODES.includes(weekMode as (typeof WEEK_MODES)[number])) {
    res.status(400).json({ message: `"weekMode" debe ser uno de: ${WEEK_MODES.join(', ')}.` });
    return;
  }
  const error =
    invalidInt(weekStartDay, 0, 6, 'weekStartDay', '0 = domingo, 6 = sábado') ??
    invalidInt(cronDay, 0, 6, 'cronDay', '0 = domingo, 6 = sábado') ??
    invalidInt(cronHour, 0, 23, 'cronHour', 'hora de RD, 0 = medianoche');
  if (error) {
    res.status(400).json({ message: error });
    return;
  }

  const data = { weekMode, weekStartDay, cronDay, cronHour };
  const updated = await db.weeklySummaryConfig.upsert({
    where: { id: 1 },
    update: { ...data, updatedBy: req.partner!.id },
    create: { id: 1, ...data, updatedBy: req.partner!.id },
  });

  // Reprograma el cron con el horario nuevo. Sin esto el cambio solo tendría
  // efecto en el siguiente reinicio del server — el socio guardaría "viernes
  // 3pm" y el reporte le seguiría saliendo el lunes 8am sin ninguna señal.
  await startWeeklySummaryCron();

  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:weekly-summary-updated',
    input: data,
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

// Reindexado manual del Cerebro. El job corre al boot y cada 6h, así que sin
// esto un cambio en Drive puede tardar hasta 6 horas en verse y la única forma
// de apurarlo es reiniciar el server. Misma función que el job, no un camino
// alternativo.
router.post('/cerebro/reindex', asyncRoute(async (req, res) => {
  const result = await runCerebroIndex();

  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:cerebro-reindex',
    resultSummary: result.ok
      ? `${result.updated} actualizados, ${result.unchanged} sin cambios, ${result.omitted} omitidos, ${result.deleted} borrados`
      : result.error,
    isError: !result.ok,
    durationMs: result.ok ? result.durationMs : undefined,
  });

  if (result.ok) {
    res.json(result);
    return;
  }
  res.status(result.error.includes('en curso') ? 409 : 502).json({ message: result.error });
}));

export default router;
