-- Permite borrar una Conversation y que sus Message/Proposal se borren en
-- cascada (antes: la foreign key sin ON DELETE CASCADE hacía fallar el
-- DELETE de una conversación con mensajes). DISENO no lo especificaba
-- explícito; hace falta para la funcionalidad de "eliminar conversación"
-- de la web (2026-07-19).
--
-- Nota: NO tocar la columna `tsv`/índice `cerebro_tsv_idx` de CerebroDoc —
-- esas viven fuera de schema.prisma (ver prisma/manual.sql) a propósito, y
-- `prisma migrate diff` las marca como drift si se compara contra el
-- schema; esta migración se escribió a mano para no arrastrar ese drop.

ALTER TABLE "Message" DROP CONSTRAINT "Message_conversationId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Proposal" DROP CONSTRAINT "Proposal_conversationId_fkey";
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
