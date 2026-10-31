-- Plan de mensajería interna (2026-10-26): cada propuesta de campaña declara su
-- objetivo (hábito, uso de una función, monetización, reactivación, aviso), y la
-- campaña diaria corre solo los días de la semana elegidos (2-3 por semana).

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "objetivo" TEXT;

-- AlterTable
ALTER TABLE "DailyCampaignConfig" ADD COLUMN     "diasSemana" INTEGER[] DEFAULT ARRAY[1, 3, 5]::INTEGER[];
