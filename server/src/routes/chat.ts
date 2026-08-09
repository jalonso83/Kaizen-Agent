import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { runAgentTurn } from '../agent/runner';
import { generateConversationTitle } from '../agent/autoTitle';
import type { SseWriter } from '../agent/tools/guard';
import { runningConversations } from '../services/runningConversations';

const DEFAULT_CONVERSATION_TITLE = 'Nueva conversación';

/** Primer bloque de texto de un array de content blocks crudo (o '' si no hay). */
function firstTextBlock(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const block = content.find((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text');
  return block && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : '';
}

// ─────────────────────────────────────────────────────────────────────────
// /api/conversations — CRUD de conversaciones + el endpoint de chat (SSE).
// DISENO_FASE1.md §3. Todo requiere sesión; ownership: toda query filtra por
// el partnerId del token (nunca se confía en un :id de la URL a secas).
// ─────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);

router.get('/', asyncRoute(async (req, res) => {
  const conversations = await db.conversation.findMany({
    where: { partnerId: req.partner!.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  res.json({ conversations });
}));

router.post('/', asyncRoute(async (req, res) => {
  const conversation = await db.conversation.create({
    data: { partnerId: req.partner!.id },
  });
  res.status(201).json(conversation);
}));

/** Busca una conversación asegurando que sea del socio autenticado. */
async function loadOwnedConversation(conversationId: string, partnerId: string) {
  return db.conversation.findFirst({ where: { id: conversationId, partnerId } });
}

router.patch('/:id', asyncRoute(async (req, res) => {
  const conversation = await loadOwnedConversation(req.params.id, req.partner!.id);
  if (!conversation) {
    res.status(404).json({ message: 'Conversación no encontrada.' });
    return;
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title) {
    res.status(400).json({ message: 'Falta "title".' });
    return;
  }
  if (title.length > 200) {
    res.status(400).json({ message: 'El título no puede superar los 200 caracteres.' });
    return;
  }

  const updated = await db.conversation.update({ where: { id: conversation.id }, data: { title } });
  res.json(updated);
}));

// Título automático tras el primer intercambio — mismo patrón que Claude.ai.
// Idempotente y defensivo: solo pisa el título si SIGUE siendo el default (si
// el socio ya lo renombró a mano, no lo tocamos) y solo si el modelo de título
// devolvió algo usable — nunca rompe el flujo de chat, esto es best-effort.
router.post('/:id/auto-title', asyncRoute(async (req, res) => {
  const conversation = await loadOwnedConversation(req.params.id, req.partner!.id);
  if (!conversation) {
    res.status(404).json({ message: 'Conversación no encontrada.' });
    return;
  }
  if (conversation.title !== DEFAULT_CONVERSATION_TITLE) {
    res.json(conversation); // ya tiene título (manual o generado antes) — no-op
    return;
  }

  const firstMessages = await db.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { seq: 'asc' },
    take: 2,
  });
  const firstUser = firstMessages.find((m) => m.role === 'user');
  const firstAssistant = firstMessages.find((m) => m.role === 'assistant');
  const firstUserText = firstUser ? firstTextBlock(firstUser.content) : '';

  if (!firstUserText) {
    res.json(conversation); // no hay texto todavía (p.ej. corrida sin turno completo)
    return;
  }

  const title = await generateConversationTitle(
    firstUserText,
    firstAssistant ? firstTextBlock(firstAssistant.content) : undefined,
  );
  if (!title) {
    res.json(conversation); // el modelo de título falló — se queda el default
    return;
  }

  const updated = await db.conversation.update({ where: { id: conversation.id }, data: { title } });
  res.json(updated);
}));

router.delete('/:id', asyncRoute(async (req, res) => {
  const conversation = await loadOwnedConversation(req.params.id, req.partner!.id);
  if (!conversation) {
    res.status(404).json({ message: 'Conversación no encontrada.' });
    return;
  }

  if (runningConversations.has(conversation.id)) {
    res.status(409).json({ message: 'El agente está respondiendo en esta conversación — esperá a que termine para borrarla.' });
    return;
  }

  // Message/Proposal se borran en cascada (migración 20260719223000).
  await db.conversation.delete({ where: { id: conversation.id } });
  res.status(204).end();
}));

router.get('/:id/messages', asyncRoute(async (req, res) => {
  const conversation = await loadOwnedConversation(req.params.id, req.partner!.id);
  if (!conversation) {
    res.status(404).json({ message: 'Conversación no encontrada.' });
    return;
  }

  const [messages, proposals] = await Promise.all([
    db.message.findMany({ where: { conversationId: conversation.id }, orderBy: { seq: 'asc' } }),
    db.proposal.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } }),
  ]);

  // Se devuelven los bloques crudos (incluye thinking) — es la fuente de
  // verdad guardada. Filtrar bloques thinking del render es responsabilidad
  // de la web (DISENO §10), no de esta API.
  res.json({ messages, proposals });
}));

// La respuesta ES el stream (decisión cerrada §0.4): un fetch+POST directo, no
// EventSource — la cookie httpOnly viaja normal y no hay canal GET paralelo.
// Compartido por el mensaje normal y por editar/reintentar (mismo protocolo
// de eventos que ya consume useAgentStream en la web).
async function streamAgentTurn(req: Request, res: Response, conversationId: string, userText: string | null): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // evita que un proxy intermedio bufferee el stream
  });
  res.flushHeaders();

  const sse: SseWriter = {
    send(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };

  // Railway corta conexiones ociosas — heartbeat cada 15s (§3).
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => clearInterval(heartbeat));

  runningConversations.add(conversationId);
  try {
    await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    await runAgentTurn(conversationId, userText, sse);
  } finally {
    runningConversations.delete(conversationId);
    clearInterval(heartbeat);
    res.end();
  }
}

router.post('/:id/messages', asyncRoute(async (req, res) => {
  const conversation = await loadOwnedConversation(req.params.id, req.partner!.id);
  if (!conversation) {
    res.status(404).json({ message: 'Conversación no encontrada.' });
    return;
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ message: 'Falta "text".' });
    return;
  }

  if (runningConversations.has(conversation.id)) {
    res.status(409).json({ message: 'El agente ya está respondiendo en esta conversación.' });
    return;
  }

  await streamAgentTurn(req, res, conversation.id, text);
}));

/**
 * Borra los mensajes de `fromSeq` en adelante (inclusive) — la base de
 * editar/reintentar/volver a un punto anterior de la conversación. Si en ese
 * rango hay una Proposal que ya representa una acción real hacia FinZen
 * (confirmada o creada), se rechaza: borrar los mensajes no deshace eso, y
 * dejar la tarjeta huérfana sin su contexto sería confuso. Las que seguían
 * PROPOSED (nunca confirmadas) se marcan SUPERSEDED — mismo estado que ya usa
 * propose_campaign para una propuesta reemplazada.
 */
async function truncateFrom(conversationId: string, fromSeq: number): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  // El corte usa el createdAt del PRIMER mensaje que se borra, nunca el del
  // mensaje que se conserva (relevante en "volver a este mensaje": si ese
  // mensaje es el que anunció una propuesta, esa propuesta nace unos
  // milisegundos DESPUÉS de su createdAt — usar el propio createdAt del
  // mensaje conservado la marcaría como "posterior" y la de-propondría sin
  // motivo, aunque el mensaje que la anunció siga ahí).
  const firstToDelete = await db.message.findFirst({ where: { conversationId, seq: fromSeq } });
  if (!firstToDelete) {
    return { ok: true }; // fromSeq más allá del final — nada que borrar (no-op válido, p.ej. rewind al último mensaje).
  }

  const risky = await db.proposal.findFirst({
    where: {
      conversationId,
      createdAt: { gte: firstToDelete.createdAt },
      status: { in: ['CONFIRMED', 'EXECUTING', 'EXECUTED', 'UNKNOWN_OUTCOME'] },
    },
  });
  if (risky) {
    return {
      ok: false,
      status: 409,
      message: 'No se puede: después de este punto hay una campaña ya confirmada o creada en FinZen — borrar el historial no deshace esa acción.',
    };
  }

  await db.proposal.updateMany({
    where: { conversationId, createdAt: { gte: firstToDelete.createdAt }, status: 'PROPOSED' },
    data: { status: 'SUPERSEDED' },
  });
  await db.message.deleteMany({ where: { conversationId, seq: { gte: fromSeq } } });
  return { ok: true };
}

router.post('/:id/messages/:messageId/edit', asyncRoute(async (req, res) => {
  const conversation = await loadOwnedConversation(req.params.id, req.partner!.id);
  if (!conversation) {
    res.status(404).json({ message: 'Conversación no encontrada.' });
    return;
  }
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ message: 'Falta "text".' });
    return;
  }
  if (runningConversations.has(conversation.id)) {
    res.status(409).json({ message: 'El agente ya está respondiendo en esta conversación.' });
    return;
  }

  const target = await db.message.findFirst({ where: { id: req.params.messageId, conversationId: conversation.id } });
  if (!target) {
    res.status(404).json({ message: 'Mensaje no encontrado.' });
    return;
  }
  if (target.role !== 'user') {
    res.status(400).json({ message: 'Solo se puede editar un mensaje del socio.' });
    return;
  }

  // Reemplaza este mensaje y todo lo posterior por el texto editado.
  const result = await truncateFrom(conversation.id, target.seq);
  if (!result.ok) {
    res.status(result.status).json({ message: result.message });
    return;
  }

  await streamAgentTurn(req, res, conversation.id, text);
}));

router.post('/:id/messages/:messageId/retry', asyncRoute(async (req, res) => {
  const conversation = await loadOwnedConversation(req.params.id, req.partner!.id);
  if (!conversation) {
    res.status(404).json({ message: 'Conversación no encontrada.' });
    return;
  }
  if (runningConversations.has(conversation.id)) {
    res.status(409).json({ message: 'El agente ya está respondiendo en esta conversación.' });
    return;
  }

  const target = await db.message.findFirst({ where: { id: req.params.messageId, conversationId: conversation.id } });
  if (!target) {
    res.status(404).json({ message: 'Mensaje no encontrado.' });
    return;
  }
  if (target.role !== 'assistant') {
    res.status(400).json({ message: 'Solo se puede reintentar una respuesta de Kaizen.' });
    return;
  }

  // Borra esta respuesta y todo lo posterior; el agente corre de nuevo sobre
  // el historial tal cual quedó (sin mensaje nuevo del socio — userText null).
  const result = await truncateFrom(conversation.id, target.seq);
  if (!result.ok) {
    res.status(result.status).json({ message: result.message });
    return;
  }

  await streamAgentTurn(req, res, conversation.id, null);
}));

router.post('/:id/messages/:messageId/rewind', asyncRoute(async (req, res) => {
  const conversation = await loadOwnedConversation(req.params.id, req.partner!.id);
  if (!conversation) {
    res.status(404).json({ message: 'Conversación no encontrada.' });
    return;
  }
  if (runningConversations.has(conversation.id)) {
    res.status(409).json({ message: 'El agente ya está respondiendo en esta conversación.' });
    return;
  }

  const target = await db.message.findFirst({ where: { id: req.params.messageId, conversationId: conversation.id } });
  if (!target) {
    res.status(404).json({ message: 'Mensaje no encontrado.' });
    return;
  }

  // A diferencia de editar/reintentar, este mensaje SE QUEDA — se borra solo
  // lo posterior. No dispara una corrida del agente, es solo "volver aquí".
  const result = await truncateFrom(conversation.id, target.seq + 1);
  if (!result.ok) {
    res.status(result.status).json({ message: result.message });
    return;
  }

  res.status(204).end();
}));

export default router;
