-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'chat';

-- CreateTable
CREATE TABLE "DailyCampaignConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cronHour" INTEGER NOT NULL DEFAULT 9,
    "conversationId" TEXT,
    "rotacionDias" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DailyCampaignConfig_pkey" PRIMARY KEY ("id")
);

-- AlterTable (mismo día, misma migración: todavía no se aplicó en ningún lado)
ALTER TABLE "DailyCampaignConfig" ADD COLUMN "modo" TEXT NOT NULL DEFAULT 'tarjeta';
