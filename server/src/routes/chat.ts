import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { runAgentTurn } from '../agent/runner';
import type { SseWriter } from '../agent/tools/guard';

// ─────────────────────────────────────────────────────────────────────────
// /api/conversations — CRUD de conversaciones + el endpoint de chat (SSE).
// DISENO_FASE1.md §3. Todo requiere sesión; ownership: toda query filtra por
// el partnerId del token (nunca se confía en un :id de la URL a secas).
// ─────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);

// Lock en memoria de "una corrida por conversación" (§3). Proceso único en
// Fase 1 — si Kaizen corre multi-instancia algún día, esto se mueve a Redis.
const runningConversations = new Set<string>();

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

  // La respuesta ES el stream (decisión cerrada §0.4): un fetch+POST directo,
  // no EventSource — la cookie httpOnly viaja normal y no hay canal GET paralelo.
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

  runningConversations.add(conversation.id);
  try {
    await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    await runAgentTurn(conversation.id, text, sse);
  } finally {
    runningConversations.delete(conversation.id);
    clearInterval(heartbeat);
    res.end();
  }
}));

export default router;
