-- El seguimiento de los anuncios de Kaizen (2026-10-05): resultados y evaluación.

-- AlterTable
ALTER TABLE "AdProposal" ADD COLUMN     "activadaEn" TIMESTAMP(3),
ADD COLUMN     "evaluadaEn" TIMESTAMP(3),
ADD COLUMN     "recomendacion" TEXT,
ADD COLUMN     "recomendacionRazon" TEXT,
ADD COLUMN     "resultado" JSONB,
ADD COLUMN     "resultadoEn" TIMESTAMP(3);
