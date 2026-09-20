import { db } from '../db';
import { audit } from './audit';
import { runAgentTurn } from '../agent/runner';
import type { SseWriter } from '../agent/tools/guard';
import { runningConversations } from './runningConversations';

// ─────────────────────────────────────────────────────────────────────────
// La transición PROPOSED → CONFIRMED y el turno que crea el borrador.
//
// Hasta 2026-09-20 esto vivía solo en routes/proposals.ts (el botón). Se
// separó porque la campaña diaria en modo "directo" necesita hacer lo mismo
// desde un job. Lo que NO cambia: quien escribe CONFIRMED es código nuestro
// —un endpoint HTTP o este servicio invocado por el cron según una
// configuración de ADMIN—, nunca una tool ni una instrucción del modelo. Y el
// borrador lo crea create_campaign_draft en un turno normal, leyendo el
// payload ya confirmado de la BD.
//
// `confirmedBy` distingue las dos puertas: el id de un socio (botón) o
// 'auto:daily-campaign' (modo directo). Auditoría los muestra distinto.
// ─────────────────────────────────────────────────────────────────────────

export const CONFIRMADO_AUTO = 'auto:daily-campaign';

export function esConfirmacionAutomatica(confirmedBy: string | null | undefined): boolean {
  return typeof confirmedBy === 'string' && confirmedBy.startsWith('auto:');
}

/**
 * Marca la propuesta como CONFIRMED y corre el turno que crea el borrador.
 * Quien llama ya verificó estado PROPOSED, permisos y que la conversación
 * no esté ocupada. Devuelve cuando el turno terminó (con sse, mientras tanto
 * lo va emitiendo).
 */
export async function confirmarYCrearBorrador(
  proposal: { id: string; conversationId: string },
  quien: { confirmedBy: string; actor: string; motivo?: string },
  sse?: SseWriter,
): Promise<void> {
  await db.proposal.update({
    where: { id: proposal.id },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: quien.confirmedBy },
  });
  await audit.log({
    conversationId: proposal.conversationId,
    actor: quien.actor,
    action: esConfirmacionAutomatica(quien.confirmedBy) ? 'proposal:auto-confirmed' : 'proposal:confirmed',
    input: { proposal_id: proposal.id, ...(quien.motivo ? { motivo: quien.motivo } : {}) },
  });

  // Mensaje user sintético (§7) — el agente lo ve como si el socio lo hubiera
  // escrito, y sabe exactamente qué tool le toca llamar.
  const syntheticText = esConfirmacionAutomatica(quien.confirmedBy)
    ? `<evento_sistema>La propuesta ${proposal.id} quedó confirmada automáticamente: la campaña diaria está configurada en modo directo (decisión del socio en Configuración). ` +
      'Procede a crear el borrador con create_campaign_draft; quedará pendiente de aprobación humana en el panel de FinZen.</evento_sistema>'
    : `<evento_sistema>El socio confirmó la propuesta ${proposal.id} pulsando el botón. ` +
      'Procede a crear el borrador con create_campaign_draft.</evento_sistema>';

  runningConversations.add(proposal.conversationId, new AbortController());
  try {
    await db.conversation.update({ where: { id: proposal.conversationId }, data: { updatedAt: new Date() } });
    await runAgentTurn(proposal.conversationId, syntheticText, sse);
  } finally {
    runningConversations.delete(proposal.conversationId);
  }
}
