// ─────────────────────────────────────────────────────────────────────────
// Lock en memoria de "una corrida por conversación" (DISENO_FASE1.md §3).
// Compartido entre routes/chat.ts (mensajes normales) y routes/proposals.ts
// (la corrida que dispara la confirmación de una propuesta) — ambos disparan
// runAgentTurn sobre la misma conversación, así que necesitan el mismo lock.
// Proceso único en Fase 1 — si Kaizen corre multi-instancia algún día, esto
// se mueve a Redis.
// ─────────────────────────────────────────────────────────────────────────

export const runningConversations = new Set<string>();
