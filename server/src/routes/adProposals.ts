import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requirePermission } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { audit } from '../services/audit';
import { persistUserText } from '../agent/history';
import { runningConversations } from '../services/runningConversations';
import { CADUCIDAD_HORAS, confirmarYCrearAnuncio, vencida } from '../services/publicidad';

// ─────────────────────────────────────────────────────────────────────────
// /api/ad-proposals/:id/{confirm,reject} — el botón de la tarjeta de anuncio
// (2026-10-04). Es la ÚNICA puerta que escribe PROPOSED → CONFIRMED y la que
// dispara la creación en Meta, siempre EN PAUSA. Permiso propio
// (publicidad:confirmar): confirmar un push y comprometer gasto en Meta no
// son la misma responsabilidad aunque hoy las tenga la misma persona.
// ─────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);
router.use(requirePermission('publicidad:confirmar'));

/** Las programadas son del negocio; las del chat, del dueño de la conversación. */
async function cargar(id: string, partnerId: string) {
  return db.adProposal.findFirst({ where: { id, OR: [{ origen: 'programada' }, { conversation: { partnerId } }] } });
}

router.post('/:id/confirm', asyncRoute(async (req, res) => {
  const p = await cargar(req.params.id, req.partner!.id);
  if (!p) {
    res.status(404).json({ message: 'Tarjeta no encontrada.' });
    return;
  }
  if (p.status !== 'PROPOSED') {
    res.status(409).json({ message: `Esta tarjeta ya no está pendiente (estado: ${p.status}).` });
    return;
  }
  if (vencida(p.createdAt)) {
    await db.adProposal.update({ where: { id: p.id }, data: { status: 'EXPIRED' } });
    res.status(409).json({ message: `La tarjeta venció: tiene más de ${CADUCIDAD_HORAS} horas y los datos con los que se propuso ya no son actuales. Pedile a Kaizen una nueva.` });
    return;
  }
  if (p.conversationId && runningConversations.has(p.conversationId)) {
    res.status(409).json({ message: 'Kaizen está respondiendo en esa conversación; espera a que termine.' });
    return;
  }

  const r = await confirmarYCrearAnuncio(p, req.partner!.id);
  if (r.ok) {
    res.json({ propuesta: r.propuesta, adsManager: r.adsManager });
    return;
  }
  // 502: Meta rechazó. La tarjeta queda en ERROR con el detalle de lo creado.
  res.status(r.propuesta.status === 'ERROR' ? 502 : 409).json({ message: r.error, propuesta: r.propuesta });
}));

router.post('/:id/reject', asyncRoute(async (req, res) => {
  const p = await cargar(req.params.id, req.partner!.id);
  if (!p) {
    res.status(404).json({ message: 'Tarjeta no encontrada.' });
    return;
  }
  if (p.status !== 'PROPOSED') {
    res.status(409).json({ message: `Esta tarjeta ya no está pendiente (estado: ${p.status}).` });
    return;
  }
  const updated = await db.adProposal.update({ where: { id: p.id }, data: { status: 'REJECTED' } });
  await audit.log({ conversationId: p.conversationId, actor: `partner:${req.partner!.id}`, action: 'ad-proposal:rejected', input: { ad_proposal_id: p.id, nombre: p.nombre } });
  if (p.conversationId) {
    await persistUserText(
      p.conversationId,
      `<evento_sistema>El socio RECHAZÓ la tarjeta de anuncio ${p.id} (post ${p.mediaPermalink}). No vuelvas a proponer ese post tal cual; si pide otro anuncio, es una propuesta nueva.</evento_sistema>`,
    );
  }
  res.json({ propuesta: updated });
}));

export default router;
