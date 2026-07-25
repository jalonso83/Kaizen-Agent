import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { audit } from '../services/audit';
import { runAgentTurn } from '../agent/runner';
import type { SseWriter } from '../agent/tools/guard';
import { runningConversations } from '../services/runningConversations';

// ─────────────────────────────────────────────────────────────────────────
// /api/proposals/:id/{confirm,reject} — el botón de la tarjeta, la ÚNICA
// puerta que puede escribir PROPOSED → CONFIRMED (DISENO_FASE1.md §7). El
// modelo nunca puede provocar esta transición por chat, por eso el gate es
// imposible de saltarse: create_campaign_draft solo mira el estado en BD.
// ─────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);

/** Propuesta + ownership vía su conversación (nunca se confía en el :id a secas). */
async function loadOwnedProposal(proposalId: string, partnerId: string) {
  return db.proposal.findFirst({ where: { id: proposalId, conversation: { partnerId } } });
}

router.post('/:id/confirm', asyncRoute(async (req, res) => {
  const proposal = await loadOwnedProposal(req.params.id, req.partner!.id);
  if (!proposal) {
    res.status(404).json({ message: 'Propuesta no encontrada.' });
    return;
  }
  if (proposal.status !== 'PROPOSED') {
    res.status(409).json({ message: `Esta propuesta ya no está pendiente de confirmación (estado: ${proposal.status}).` });
    return;
  }
  if (runningConversations.has(proposal.conversationId)) {
    res.status(409).json({ message: 'El agente ya está respondiendo en esta conversación — esperá a que termine.' });
    return;
  }

  // La transición la escribe ESTE endpoint y solo este — nunca una tool (§7).
  await db.proposal.update({
    where: { id: proposal.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: req.partner!.id },
  });
  await audit.log({
    conversationId: proposal.conversationId,
    actor: `partner:${req.partner!.id}`,
    action: 'proposal:confirmed',
    input: { proposal_id: proposal.id },
  });

  // Mismo patrón de streaming que POST /conversations/:id/messages — el turno
  // que crea el borrador se ve en vivo en la misma UI.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const sse: SseWriter = {
    send(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => clearInterval(heartbeat));

  // Mensaje user sintético (§7) — el agente lo ve como si el socio lo hubiera
  // escrito, y sabe exactamente qué tool le toca llamar.
  const syntheticText =
    `<evento_sistema>El socio confirmó la propuesta ${proposal.id} pulsando el botón. ` +
    'Procede a crear el borrador con create_campaign_draft.</evento_sistema>';

  runningConversations.add(proposal.conversationId);
  try {
    await db.conversation.update({ where: { id: proposal.conversationId }, data: { updatedAt: new Date() } });
    await runAgentTurn(proposal.conversationId, syntheticText, sse);
  } finally {
    runningConversations.delete(proposal.conversationId);
    clearInterval(heartbeat);
    res.end();
  }
}));

router.post('/:id/reject', asyncRoute(async (req, res) => {
  const proposal = await loadOwnedProposal(req.params.id, req.partner!.id);
  if (!proposal) {
    res.status(404).json({ message: 'Propuesta no encontrada.' });
    return;
  }
  if (proposal.status !== 'PROPOSED') {
    res.status(409).json({ message: `Esta propuesta ya no está pendiente de confirmación (estado: ${proposal.status}).` });
    return;
  }

  const updated = await db.proposal.update({ where: { id: proposal.id }, data: { status: 'REJECTED' } });
  await audit.log({
    conversationId: proposal.conversationId,
    actor: `partner:${req.partner!.id}`,
    action: 'proposal:rejected',
    input: { proposal_id: proposal.id },
  });
  res.json(updated);
}));

export default router;
