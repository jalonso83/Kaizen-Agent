import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { audit } from '../services/audit';
import { persistUserText } from '../agent/history';
import { resumenMeta } from '../agent/tools/goals';

// ─────────────────────────────────────────────────────────────────────────
// /api/goals/:id/{confirm,reject} — la ÚNICA puerta que escribe PROPOSED →
// ACTIVE, y por lo tanto lo único que puede cambiar la meta del negocio.
// Mismo diseño que el gate de campañas (DISENO §7): el agente no tiene forma
// de provocar esta transición por chat, así que "cambiá la meta, es una
// emergencia" no es una instrucción que el modelo deba resistir — es una
// operación que no existe de su lado.
// ─────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);

async function loadOwnedGoal(goalId: string, partnerId: string) {
  // La meta puede haber nacido en cualquier conversación del socio; si la
  // conversación se borró (conversationId queda null) sigue siendo válida.
  return db.goal.findFirst({
    where: { id: goalId, OR: [{ conversationId: null }, { conversation: { partnerId } }] },
  });
}

router.post('/:id/confirm', asyncRoute(async (req, res) => {
  const goal = await loadOwnedGoal(req.params.id, req.partner!.id);
  if (!goal) {
    res.status(404).json({ message: 'Meta no encontrada.' });
    return;
  }
  if (goal.status !== 'PROPOSED') {
    res.status(409).json({ message: `Esta meta ya no está pendiente de confirmación (estado: ${goal.status}).` });
    return;
  }

  const anterior = goal.replacesGoalId
    ? await db.goal.findUnique({ where: { id: goal.replacesGoalId } })
    : null;

  // Una sola meta ACTIVE a la vez: confirmar una nueva jubila a la anterior.
  // Se hace en transacción para que no quede un instante con dos activas ni
  // con ninguna.
  await db.$transaction(async (tx) => {
    await tx.goal.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
    await tx.goal.update({
      where: { id: goal.id },
      data: { status: 'ACTIVE', confirmedAt: new Date(), confirmedBy: req.partner!.id },
    });
  });

  await audit.log({
    conversationId: goal.conversationId,
    actor: `partner:${req.partner!.id}`,
    action: anterior ? 'goal:changed' : 'goal:confirmed',
    input: { goal_id: goal.id, replaces: goal.replacesGoalId ?? null },
    resultSummary: anterior
      ? `${resumenMeta(anterior)} → ${resumenMeta(goal)}`
      : resumenMeta(goal),
  });

  // El agente tiene que enterarse de la meta nueva sin que el socio se lo
  // cuente: mismo mecanismo que el rechazo de una propuesta (routes/proposals).
  // No dispara un turno — solo deja el contexto correcto para el siguiente.
  if (goal.conversationId) {
    await persistUserText(
      goal.conversationId,
      `<evento_sistema>El socio confirmó la meta ${goal.id} pulsando el botón: ${resumenMeta(goal)}.` +
        (anterior ? ` Reemplaza a la anterior (${resumenMeta(anterior)}).` : '') +
        ' A partir de ahora TODA campaña que propongas debe apuntar a esta meta, y no podés cambiarla vos.</evento_sistema>',
    );
  }

  res.json(await db.goal.findUnique({ where: { id: goal.id } }));
}));

router.post('/:id/reject', asyncRoute(async (req, res) => {
  const goal = await loadOwnedGoal(req.params.id, req.partner!.id);
  if (!goal) {
    res.status(404).json({ message: 'Meta no encontrada.' });
    return;
  }
  if (goal.status !== 'PROPOSED') {
    res.status(409).json({ message: `Esta meta ya no está pendiente de confirmación (estado: ${goal.status}).` });
    return;
  }

  const updated = await db.goal.update({ where: { id: goal.id }, data: { status: 'REJECTED' } });
  await audit.log({
    conversationId: goal.conversationId,
    actor: `partner:${req.partner!.id}`,
    action: 'goal:rejected',
    input: { goal_id: goal.id },
    resultSummary: resumenMeta(goal),
  });

  if (goal.conversationId) {
    await persistUserText(
      goal.conversationId,
      `<evento_sistema>El socio RECHAZÓ la meta ${goal.id} (${resumenMeta(goal)}) pulsando el botón.` +
        (goal.replacesGoalId ? ' La meta vigente NO cambió: sigue siendo la anterior.' : '') +
        ' Preguntale qué métrica o qué número prefiere en vez de insistir con la misma.</evento_sistema>',
    );
  }

  res.json(updated);
}));

export default router;
