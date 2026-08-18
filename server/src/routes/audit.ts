import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';

// ─────────────────────────────────────────────────────────────────────────
// /api/audit — la pantalla de Auditoría (criterio 6 del PRD: "audit log
// consultable de todas las acciones").
//
// Dos endpoints con propósitos distintos, y esa separación es el diseño:
//  - /overview responde PREGUNTAS: ¿está todo corriendo? ¿alguna campaña llegó
//    a FinZen sin que un socio la confirmara? Es lo primero que se ve.
//  - /events es la EVIDENCIA cruda detrás de esas respuestas.
//
// Solo lectura: la tabla es append-only por trigger de Postgres (manual.sql) y
// acá no hay ni un método de escritura. Cualquier socio logueado ve todo — en
// Fase 1 no hay roles.
// ─────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);

/** El `id` de AuditLog es BigInt y JSON.stringify explota con eso. */
function serializable<T extends { id: bigint }>(row: T): Omit<T, 'id'> & { id: string } {
  return { ...row, id: row.id.toString() };
}

/** Última corrida de un job, mirando todas las acciones que la representan. */
async function ultimaCorrida(...acciones: string[]) {
  const fila = await db.auditLog.findFirst({
    where: { action: { in: acciones } },
    orderBy: { createdAt: 'desc' },
    select: { action: true, resultSummary: true, isError: true, createdAt: true },
  });
  if (!fila) return null;
  return { at: fila.createdAt, ok: !fila.isError, detail: fila.resultSummary ?? '' };
}

router.get('/overview', asyncRoute(async (_req, res) => {
  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [resumenSemanal, indexado, errores24h, propuestas, denegados, socios] = await Promise.all([
    ultimaCorrida('weekly-summary:done', 'weekly-summary:error'),
    // Tres acciones distintas para lo mismo: el job de cada 6h (done/error) y
    // el botón manual. Mirar solo la del botón hacía que la tarjeta mostrara la
    // última vez que alguien reindexó a mano y nunca las corridas automáticas.
    ultimaCorrida('cerebro-index:done', 'cerebro-index:error', 'config:cerebro-reindex'),
    db.auditLog.count({ where: { isError: true, createdAt: { gte: hace24h } } }),
    // La reconciliación del gate sale de Proposal, que es la fuente de verdad
    // de quién confirmó qué (confirmedBy SOLO lo escribe el endpoint HTTP).
    db.proposal.findMany({
      where: { OR: [{ finzenCampaignId: { not: null } }, { status: { in: ['CONFIRMED', 'EXECUTING', 'EXECUTED', 'UNKNOWN_OUTCOME'] } }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, status: true, payload: true, confirmedAt: true, confirmedBy: true,
        executedAt: true, finzenCampaignId: true, error: true, createdAt: true,
      },
    }),
    db.auditLog.findMany({
      where: { action: 'gate:denied' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, resultSummary: true, createdAt: true },
    }),
    db.partner.findMany({ select: { id: true, name: true } }),
  ]);

  const nombrePorId = new Map(socios.map((p) => [p.id, p.name]));

  const campanas = propuestas.map((p) => {
    const payload = p.payload as { title?: string } | null;
    return {
      id: p.id,
      titulo: payload?.title ?? '(sin título)',
      status: p.status,
      confirmedAt: p.confirmedAt,
      confirmadaPor: p.confirmedBy ? (nombrePorId.get(p.confirmedBy) ?? 'socio desconocido') : null,
      executedAt: p.executedAt,
      finzenCampaignId: p.finzenCampaignId,
      error: p.error,
      // LA pregunta del criterio 3: un borrador que llegó a FinZen sin que
      // ningún socio pulsara Confirmar. Nunca debería existir.
      sinConfirmacion: Boolean(p.finzenCampaignId) && !p.confirmedBy,
    };
  });

  res.json({
    health: {
      resumenSemanal,
      indexado,
      errores24h,
    },
    gate: {
      borradoresCreados: campanas.filter((c) => c.finzenCampaignId).length,
      sinConfirmacion: campanas.filter((c) => c.sinConfirmacion).length,
      bloqueados: await db.auditLog.count({ where: { action: 'gate:denied' } }),
      campanas,
      denegados: denegados.map(serializable),
    },
  });
}));

const PAGE_SIZE = 60;

router.get('/events', asyncRoute(async (req, res) => {
  const soloErrores = req.query.onlyErrors === 'true';
  const todo = req.query.level === 'all';
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const desde = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;

  // "Importantes" esconde las llamadas a herramientas que salieron bien: son el
  // 95% de las filas y no aportan nada por sí solas. Las que FALLARON sí quedan,
  // porque una herramienta que revienta es justo lo que hay que ver.
  const where = {
    ...(soloErrores ? { isError: true } : {}),
    ...(todo ? {} : { NOT: { AND: [{ action: { startsWith: 'tool:' } }, { isError: false }] } }),
    ...(desde && !Number.isNaN(desde.getTime()) ? { createdAt: { gte: desde } } : {}),
    ...(cursor ? { id: { lt: BigInt(cursor) } } : {}),
  };

  const filas = await db.auditLog.findMany({
    where,
    orderBy: { id: 'desc' },
    take: PAGE_SIZE + 1,
  });

  const hayMas = filas.length > PAGE_SIZE;
  const pagina = hayMas ? filas.slice(0, PAGE_SIZE) : filas;

  // Título de la conversación y nombre del socio, para no mostrar cuids crudos.
  const ids = [...new Set(pagina.map((f) => f.conversationId).filter((v): v is string => Boolean(v)))];
  const [conversaciones, socios] = await Promise.all([
    ids.length ? db.conversation.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }) : [],
    db.partner.findMany({ select: { id: true, name: true } }),
  ]);
  const tituloPorId = new Map(conversaciones.map((c) => [c.id, c.title]));
  const nombrePorId = new Map(socios.map((p) => [p.id, p.name]));

  res.json({
    events: pagina.map((f) => ({
      ...serializable(f),
      conversationTitle: f.conversationId ? (tituloPorId.get(f.conversationId) ?? null) : null,
      actorName: f.actor.startsWith('partner:') ? (nombrePorId.get(f.actor.slice(8)) ?? null) : null,
    })),
    nextCursor: hayMas ? pagina[pagina.length - 1].id.toString() : null,
  });
}));

export default router;
