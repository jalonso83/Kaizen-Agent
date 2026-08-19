-- La meta vigente del negocio (metrica + numero) que Kaizen persigue con sus
-- campañas. El estado ACTIVE lo escribe SOLO el endpoint HTTP del boton, igual
-- que CONFIRMED en Proposal: el agente puede proponer una meta o su cambio,
-- pero no puede activarla ni reemplazarla por su cuenta.
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "metric" TEXT NOT NULL,
    "metricLabel" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'gte',
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "achievedAt" TIMESTAMP(3),
    "achievedValue" DOUBLE PRECISION,
    "achievedNote" TEXT,
    "replacesGoalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Goal_status_createdAt_idx" ON "Goal"("status", "createdAt");

-- SetNull y no Cascade: borrar la conversacion donde se propuso la meta no debe
-- borrar la meta — es del negocio, no del hilo.
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
