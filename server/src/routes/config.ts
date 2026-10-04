import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requirePermission } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { audit } from '../services/audit';
import { runWeeklySummary, startWeeklySummaryCron } from '../jobs/weeklySummary';
import { runDailyCampaign, startDailyCampaignCron } from '../jobs/dailyCampaign';
import { runCerebroIndex } from '../jobs/cerebroIndex';
import { runMetaAds, startMetaAdsCron } from '../jobs/metaAds';
import { runAdResults } from '../jobs/adResults';
import { faltaParaCrear, validarConfigPublicidad } from '../services/publicidad';
import { config as appConfig } from '../config';

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
    id: 1, enabled: false, cronHour: 9, modo: 'tarjeta', conversationId: null, rotacionDias: 7, updatedAt: null, updatedBy: null,
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
  let conversationId = req.body?.conversationId as string | null | undefined;
  const rotacionDias = req.body?.rotacionDias ?? 7;
  const modo = (req.body?.modo ?? 'tarjeta') as string;

  if (typeof enabled !== 'boolean') {
    res.status(400).json({ message: '"enabled" debe ser true o false.' });
    return;
  }
  if (modo !== 'tarjeta' && modo !== 'directo') {
    res.status(400).json({ message: '"modo" debe ser "tarjeta" o "directo".' });
    return;
  }
  const error =
    invalidInt(cronHour, 0, 23, 'cronHour', 'hora de RD, 0 = medianoche') ??
    invalidInt(rotacionDias, 1, 30, 'rotacionDias', 'días sin repetir un segmento');
  if (error) {
    res.status(400).json({ message: error });
    return;
  }
  // "Nueva conversación": la crea el servidor a nombre de quien configura y
  // queda elegida hasta que alguien la cambie. Así el socio no tiene que
  // salir del diálogo a crearla.
  if (conversationId === '__nueva__') {
    const nueva = await db.conversation.create({ data: { partnerId: req.partner!.id, title: 'Campañas diarias' } });
    conversationId = nueva.id;
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
  // En modo tarjeta la conversación es la decisión del socio. En modo directo
  // el job la crea solo si falta.
  if (enabled && modo === 'tarjeta' && !conversationId) {
    res.status(400).json({ message: 'Para encender la campaña diaria con tarjeta hace falta elegir la conversación donde va a caer (o "Nueva conversación").' });
    return;
  }

  const previo = await db.dailyCampaignConfig.findUnique({ where: { id: 1 } });
  const data = { enabled, cronHour, modo, conversationId: conversationId ?? null, rotacionDias };
  const updated = await db.dailyCampaignConfig.upsert({
    where: { id: 1 },
    update: { ...data, updatedBy: req.partner!.id },
    create: { id: 1, ...data, updatedBy: req.partner!.id },
  });
  await startDailyCampaignCron();
  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:daily-campaign-updated',
    input: { ...data, anterior: previo ? { enabled: previo.enabled, cronHour: previo.cronHour, modo: previo.modo, conversationId: previo.conversationId, rotacionDias: previo.rotacionDias } : null },
  });
  const conv = updated.conversationId ? await db.conversation.findUnique({ where: { id: updated.conversationId }, select: { id: true, title: true, partnerId: true } }) : null;
  res.json({ ...updated, conversacion: conv ? { id: conv.id, title: conv.title, esMia: conv.partnerId === req.partner!.id } : null });
}));

// Corrida manual: misma función que el cron. Con forzar, corre aunque esté
// apagada (para probarla antes de encenderla), pero necesita la conversación.
router.post('/daily-campaign/run-now', asyncRoute(async (req, res) => {
  const result = await runDailyCampaign({ forzar: true });
  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:daily-campaign-run-now',
    resultSummary: result.ok ? `corrió en ${result.conversationId} · modo ${result.modo}${result.borradorAutomatico ? ' · borrador automático' : ''} · permitidos: ${result.permitidos.join(', ')}` : result.omitido,
    isError: !result.ok,
  });
  if (result.ok) {
    res.json(result);
    return;
  }
  res.status(result.omitido.includes('en curso') || result.omitido.includes('ocupada') ? 409 : 400).json({ message: result.omitido });
}));

// ── Publicidad automática en Meta (2026-10-04) ────────────────────────────
// Lo que devuelve además de la fila: el tope de Railway (para que la pantalla
// no deje pedir más) y qué falta para poder crear (variables o escritura).
async function vistaMetaAds(partnerId: string) {
  const cfg = await db.metaAdsConfig.findUnique({ where: { id: 1 } });
  const conv = cfg?.conversationId
    ? await db.conversation.findUnique({ where: { id: cfg.conversationId }, select: { id: true, title: true, partnerId: true } })
    : null;
  return {
    config: cfg,
    conversacion: conv ? { id: conv.id, title: conv.title, esMia: conv.partnerId === partnerId } : null,
    topeDiarioUsd: appConfig.meta.maxDailyBudgetUsd,
    falta: faltaParaCrear(),
  };
}

router.get('/meta-ads', asyncRoute(async (req, res) => {
  res.json(await vistaMetaAds(req.partner!.id));
}));

router.put('/meta-ads', asyncRoute(async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const cuerpo = {
    enabled: b.enabled,
    diasSemana: b.diasSemana,
    cronHour: b.cronHour,
    presupuestoDiario: b.presupuestoDiario,
    duracionDias: b.duracionDias,
    objetivo: b.objetivo,
    urlDestino: typeof b.urlDestino === 'string' && b.urlDestino.trim() ? b.urlDestino.trim() : null,
    paises: b.paises,
    edadMin: b.edadMin,
    edadMax: b.edadMax,
    categoriaFinanciera: b.categoriaFinanciera,
    rotacionDias: b.rotacionDias ?? 30,
  };
  const error = validarConfigPublicidad(cuerpo);
  if (error) {
    res.status(400).json({ message: error });
    return;
  }

  let conversationId = b.conversationId as string | null | undefined;
  if (conversationId === '__nueva__') {
    const nueva = await db.conversation.create({ data: { partnerId: req.partner!.id, title: 'Publicidad en Meta' } });
    conversationId = nueva.id;
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
  if (cuerpo.enabled && !conversationId) {
    res.status(400).json({ message: 'Para encender la publicidad automática hace falta elegir la conversación donde van a caer las tarjetas (o "Nueva conversación").' });
    return;
  }

  const data = {
    enabled: cuerpo.enabled as boolean,
    diasSemana: [...new Set(cuerpo.diasSemana as number[])].sort((x, y) => x - y),
    cronHour: cuerpo.cronHour as number,
    presupuestoDiario: cuerpo.presupuestoDiario as number,
    duracionDias: cuerpo.duracionDias as number,
    objetivo: cuerpo.objetivo as string,
    urlDestino: cuerpo.urlDestino,
    paises: cuerpo.paises as string[],
    edadMin: cuerpo.edadMin as number,
    edadMax: cuerpo.edadMax as number,
    categoriaFinanciera: cuerpo.categoriaFinanciera as boolean,
    rotacionDias: cuerpo.rotacionDias as number,
    conversationId: conversationId ?? null,
  };
  const previo = await db.metaAdsConfig.findUnique({ where: { id: 1 } });
  await db.metaAdsConfig.upsert({
    where: { id: 1 },
    update: { ...data, updatedBy: req.partner!.id },
    create: { id: 1, ...data, updatedBy: req.partner!.id },
  });
  await startMetaAdsCron();
  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:meta-ads-updated',
    input: { ...data, anterior: previo ? { ...previo, updatedAt: undefined } : null },
  });
  res.json(await vistaMetaAds(req.partner!.id));
}));

// Corrida manual: misma función que el cron. Con forzar corre aunque esté
// apagada, para probarla antes de encenderla.
router.post('/meta-ads/run-now', asyncRoute(async (req, res) => {
  const result = await runMetaAds({ forzar: true });
  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:meta-ads-run-now',
    resultSummary: result.ok ? `corrió en ${result.conversationId} · ${result.tarjeta ? `tarjeta ${result.tarjeta}` : 'sin tarjeta'}` : result.omitido,
    isError: !result.ok,
  });
  if (result.ok) {
    res.json(result);
    return;
  }
  res.status(result.omitido.includes('en curso') || result.omitido.includes('ocupada') ? 409 : 400).json({ message: result.omitido });
}));

// Seguimiento manual de los anuncios: la misma función que el job de las 7am.
router.post('/meta-ads/results-now', asyncRoute(async (req, res) => {
  const r = await runAdResults();
  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'config:ad-results-run-now',
    resultSummary: `${r.leidos} leídos · ${r.evaluados.length} evaluados${r.fallidos.length ? ` · fallidos: ${r.fallidos.join(' · ')}` : ''}`,
    isError: r.fallidos.length > 0,
  });
  res.json(r);
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
