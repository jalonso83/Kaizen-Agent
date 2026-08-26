// ─────────────────────────────────────────────────────────────────────────
// Lock en memoria de "una corrida por conversación" (DISENO_FASE1.md §3).
// Compartido entre routes/chat.ts (mensajes normales) y routes/proposals.ts
// (la corrida que dispara la confirmación de una propuesta) — ambos disparan
// runAgentTurn sobre la misma conversación, así que necesitan el mismo lock.
// Proceso único en Fase 1 — si Kaizen corre multi-instancia algún día, esto
// se mueve a Redis.
//
// Guarda el AbortController de cada corrida, no solo su id: es lo que permite
// que POST /:id/stop la corte desde OTRA petición.
//
// POR QUÉ EL BOTÓN DETENER NO ABORTA EL FETCH DEL NAVEGADOR: si el cliente
// cuelga la conexión, el server se entera y corta, pero el cliente ya recargó
// el historial mientras el server todavía estaba guardando el fragmento —
// carrera perdida, y el texto a medias desaparecía de la pantalla (bug real,
// 2026-08-26). Con un endpoint aparte el stream sigue abierto: el server corta,
// guarda, manda `done` y recién ahí cierra. El cliente recarga sobre un
// historial que ya tiene el fragmento.
// ─────────────────────────────────────────────────────────────────────────

const corridas = new Map<string, AbortController>();

export const runningConversations = {
  has(conversationId: string): boolean {
    return corridas.has(conversationId);
  },

  add(conversationId: string, abort: AbortController): void {
    corridas.set(conversationId, abort);
  },

  delete(conversationId: string): void {
    corridas.delete(conversationId);
  },

  /** Corta la corrida en curso. Devuelve false si no había ninguna. */
  stop(conversationId: string): boolean {
    const abort = corridas.get(conversationId);
    if (!abort) return false;
    abort.abort();
    return true;
  },
};
