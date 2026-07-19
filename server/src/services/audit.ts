import { db } from '../db';

// ─────────────────────────────────────────────────────────────────────────
// audit.log() — la ÚNICA API de escritura al audit log (DISENO_FASE1.md §0.8, §2).
// La tabla AuditLog es append-only (trigger de Postgres en manual.sql): aquí solo
// se inserta, nunca se actualiza ni borra. Toda acción del agente contra
// FinZen/Drive/Meta y toda transición de propuesta pasa por aquí.
//
// Un fallo al escribir el log NO debe tumbar el turno del socio: se registra en
// consola y se sigue. La durabilidad real la garantiza Postgres en producción.
// ─────────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  conversationId?: string | null;
  actor: string; // 'agent' | 'partner:<id>' | 'cron' | 'system'
  action: string; // 'tool:get_kpis' | 'proposal:confirmed' | 'gate:denied' | ...
  input?: unknown;
  resultSummary?: string; // ya truncado a ≤2000 chars por quien llama
  isError?: boolean;
  durationMs?: number;
}

export const audit = {
  async log(entry: AuditEntry): Promise<void> {
    try {
      await db.auditLog.create({
        data: {
          conversationId: entry.conversationId ?? null,
          actor: entry.actor,
          action: entry.action,
          // Prisma Json: el input de las tools es JSON-serializable; cast pragmático.
          input: entry.input === undefined ? undefined : (entry.input as never),
          resultSummary: entry.resultSummary,
          isError: entry.isError ?? false,
          durationMs: entry.durationMs,
        },
      });
    } catch (err) {
      console.error(
        `[audit] No se pudo escribir el log de "${entry.action}" (¿DB disponible? ¿DATABASE_URL?):`,
        err instanceof Error ? err.message : err,
      );
    }
  },
};
