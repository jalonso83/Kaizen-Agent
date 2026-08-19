-- Bajo qué meta nació cada campaña.
--
-- Nullable y sin backfill a propósito: las propuestas anteriores a que
-- existieran las metas NO se pueden asignar a ninguna sin inventar el dato.
-- Se muestran como "sin meta registrada", que es la verdad.
--
-- ON DELETE SET NULL: borrar una meta no debe borrar el historial de campañas.
ALTER TABLE "Proposal" ADD COLUMN "goalId" TEXT;

ALTER TABLE "Proposal"
  ADD CONSTRAINT "Proposal_goalId_fkey"
  FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Proposal_goalId_idx" ON "Proposal"("goalId");
