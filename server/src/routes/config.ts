import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requirePermission } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { audit } from '../services/audit';
import { runWeeklySummary, startWeeklySummaryCron } from '../jobs/weeklySummary';
import { runDailyCampaign, startDailyCampaignCron } from '../jobs/dailyCampaign';
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
router.use(requirePermission('config:editar'));

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

  // El estado ANTES de tocarlo, para que el evento de auditoría diga de qué a
  // qué se cambió sin tener que deducirlo del evento anterior (que puede caer
  // fuera de la página cargada, o no existir). Se lee antes del upsert: después
  // ya no está.
  const previo = await db.weeklySummaryConfig.findUnique({ where: { id: 1 } });
  const anterior = previo
    ? { weekMode: previo.weekMode, weekStartDay: previo.weekStartDay, cronDay: previo.cronDay, cronHour: previo.cronHour }
    : null;

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
    input: { ...data, anterior },
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

// ── Campaña diaria (2026-09-20) ───────────────────────────────────────────

router.get('/daily-campaign', asyncRoute(async (req, res) => {
  const cfg = (await db.dailyCampaignConfig.findUnique({ where: { id: 1 } })) ?? {
    id: 1, enabled: false, cronHour: 9, conversationId: null, rotacionDias: 7, updatedAt: null, updatedBy: null,
  };
  // La conversación destino tiene que existir y ser de quien configura (las
  // conversaciones son por socio; la tarjeta la ve su dueño). Si la borraron,
  // se devuelve el id igual pero con titulo null, y la interfaz lo dice.
  const conv = cfg.conversationId
    ? await db.conversation.findUnique({ where: { id: cfg.conversationId }, select: { id: true, title: true, partnerId: true } })
    : null;
  res.json({ ...cfg, conversacion: conv ? { id: conv.id, title: conv.title, esMia: conv.partnerId === req.partner!.id } : null });
}));

router.put('/daily-campaign', asyncRoute(async (req, res) => {
  const enabled = req.body?.enabled;
  const cronHour = req.body?.cronHour;
  const conversationId = req.body?.conversationId as string | null | undefined;
  const rotacionDias = req.body?.rotacionDias ?? 7;

  if (typeof enabled !== 'boolean') {
    res.status(400).json({ message: '"enabled" debe ser true o false.' });
    return;
  }
  const error =
    invalidInt(cronHour, 0, 23, 'cronHour', 'hora de RD, 0 = medianoche') ??
    invalidInt(rotacionDias, 1, 30, 'rotacionDias', 'días sin repetir un segmento');
  if (error) {
    res.status(400).json({ message: error });
    return;
  }
  if (conversationId) {
    const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { partnerId: true } });
    if (!conv) {
      res.status(400).json({ message: 'La conversación elegida no existe.' });
      return;
    }
    if (conv.partnerId !== req.partner!.id) {
      res.status(400).json({ message: 'La conversación destino tiene que ser tuya: la tarjeta la ve el dueño de la conversación.' });
      return;
    }
  }
  if (enabled && !conversationId) {
    res.status(400).json({ message: 'Para encender la campaña diaria hace falta elegir la conversación donde va a caer la tarjeta.' });
    return;
  }

  const previo = await db.dailyCampaignConfig.findUnique({ where: { id: 1 } });
  const data = { enabled, cronHour, conversationId: conversationId ?? null, rotacionDias };
  const updated = await db.dailyCampaignConfig.upsert({
    where: { id: 1 },
    update: { ...data, updatedBy: req.partner!.id },
    create: { id: 1, ...data, updatedBy: req.partner!.id },
  });
  await startDailyCampaignCron();
  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:daily-campaign-updated',
    input: { ...data, anterior: previo ? { enabled: previo.enabled, cronHour: previo.cronHour, conversationId: previo.conversationId, rotacionDias: previo.rotacionDias } : null },
  });
  res.json(updated);
}));

// Corrida manual: misma función que el cron. Con forzar, corre aunque esté
// apagada (para probarla antes de encenderla), pero necesita la conversación.
router.post('/daily-campaign/run-now', asyncRoute(async (req, res) => {
  const result = await runDailyCampaign({ forzar: true });
  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:daily-campaign-run-now',
    resultSummary: result.ok ? `corrió en ${result.conversationId} · permitidos: ${result.permitidos.join(', ')}` : result.omitido,
    isError: !result.ok,
  });
  if (result.ok) {
    res.json(result);
    return;
  }
  res.status(result.omitido.includes('en curso') || result.omitido.includes('ocupada') ? 409 : 400).json({ message: result.omitido });
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
      ? `${result.updated} actualizados, ${result.unchanged} sin cambios, ${result.omitted} omitidos, ` +
        `${result.deleted} borrados, ${result.failed.length} fallidos${result.failed.length ? `: ${result.failed.join(' · ')}` : ''}`
      : result.error,
    // Un archivo que Drive listó y no se pudo descargar queda fuera del índice:
    // la corrida "terminó", pero el resultado no es sano.
    isError: !result.ok || result.failed.length > 0,
    durationMs: result.ok ? result.durationMs : undefined,
  });

  if (result.ok) {
    res.json(result);
    return;
  }
  res.status(result.error.includes('en curso') ? 409 : 502).json({ message: result.error });
}));

export default router;
