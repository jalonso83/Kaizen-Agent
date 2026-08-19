import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { resumenMeta } from '../agent/tools/goals';

// ─────────────────────────────────────────────────────────────────────────
// /api/goals/history — la pantalla de Metas.
//
// La pregunta que responde no es "¿cuál es la meta?" (eso ya se ve en el chat)
// sino "¿esta meta guió algo, y cómo terminó?". Por eso cada meta viene con las
// campañas que se propusieron bajo ella: una meta sin campañas es una meta de
// adorno, y eso tiene que poder verse de un vistazo.
//
// El vínculo campaña→meta es un campo grabado al proponer (Proposal.goalId), no
// una inferencia por fechas. Deducirlo por ventanas de tiempo daría números
// plausibles y equivocados: entre que se propone una campaña y que se ejecuta,
// la meta puede haber cambiado.
//
// Solo lectura. Confirmar y rechazar viven en routes/goals.ts, que es la única
// puerta que escribe estados.
// ─────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);

/** Estados de Proposal que significan que la campaña llegó de verdad a FinZen. */
const LLEGO_A_FINZEN = ['EXECUTED', 'EXECUTING', 'UNKNOWN_OUTCOME'];

router.get('/history', asyncRoute(async (_req, res) => {
  const [metas, socios, sinMeta] = await Promise.all([
    db.goal.findMany({
      orderBy: [{ confirmedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        proposals: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, status: true, payload: true, messageType: true,
            executedAt: true, finzenCampaignId: true, createdAt: true,
          },
        },
        conversation: { select: { id: true, title: true } },
      },
    }),
    db.partner.findMany({ select: { id: true, name: true } }),
    // Las campañas que nacieron antes de que existieran las metas. No se les
    // asigna ninguna: se cuentan aparte y se dice por qué.
    db.proposal.count({ where: { goalId: null } }),
  ]);

  const nombrePorId = new Map(socios.map((p) => [p.id, p.name]));
  const resumenPorId = new Map(metas.map((g) => [g.id, resumenMeta(g)]));

  // Cuándo dejó de estar vigente cada meta. Se calcula acá y no en el front
  // porque hace falta cruzar toda la lista: una meta reemplazada termina
  // cuando se confirmó la que la reemplazó.
  const finPorId = new Map<string, Date>();
  for (const g of metas) {
    if (g.achievedAt) finPorId.set(g.id, g.achievedAt);
    if (g.replacesGoalId && g.confirmedAt && !finPorId.has(g.replacesGoalId)) {
      finPorId.set(g.replacesGoalId, g.confirmedAt);
    }
  }

  res.json({
    metas: metas.map((g) => {
      const campanas = g.proposals.map((p) => {
        const payload = p.payload as { title?: string } | null;
        return {
          id: p.id,
          titulo: payload?.title ?? '(sin título)',
          status: p.status,
          messageType: p.messageType,
          executedAt: p.executedAt,
          finzenCampaignId: p.finzenCampaignId,
          createdAt: p.createdAt,
          llegoAFinzen: LLEGO_A_FINZEN.includes(p.status),
        };
      });

      return {
        id: g.id,
        resumen: resumenMeta(g),
        metricLabel: g.metricLabel,
        target: g.target,
        unit: g.unit,
        direction: g.direction,
        rationale: g.rationale,
        status: g.status,
        confirmedAt: g.confirmedAt,
        confirmadaPor: g.confirmedBy ? (nombrePorId.get(g.confirmedBy) ?? 'socio eliminado') : null,
        achievedAt: g.achievedAt,
        achievedValue: g.achievedValue,
        achievedNote: g.achievedNote,
        createdAt: g.createdAt,
        /** Cuándo dejó de estar vigente. Null si sigue activa o nunca lo estuvo. */
        hasta: finPorId.get(g.id) ?? null,
        reemplazaA: g.replacesGoalId ? (resumenPorId.get(g.replacesGoalId) ?? null) : null,
        conversacion: g.conversation,
        campanas,
        propuestas: campanas.length,
        publicadas: campanas.filter((c) => c.llegoAFinzen).length,
      };
    }),
    campanasSinMeta: sinMeta,
  });
}));

export default router;
