-- La publicidad automática en Meta (2026-10-04): las tarjetas de anuncio y su configuración.

-- CreateTable
CREATE TABLE "AdProposal" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "origen" TEXT NOT NULL DEFAULT 'chat',
    "mediaId" TEXT NOT NULL,
    "mediaPermalink" TEXT NOT NULL,
    "mediaTipo" TEXT,
    "mediaCaption" TEXT,
    "nombre" TEXT NOT NULL,
    "objetivo" TEXT NOT NULL,
    "urlDestino" TEXT,
    "presupuestoDiario" DOUBLE PRECISION NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'USD',
    "duracionDias" INTEGER NOT NULL,
    "segmentacion" JSONB NOT NULL,
    "racional" TEXT NOT NULL,
    "medicion" TEXT NOT NULL,
    "metaCampaignId" TEXT,
    "metaAdSetId" TEXT,
    "metaCreativeId" TEXT,
    "metaAdId" TEXT,
    "inicio" TIMESTAMP(3),
    "fin" TIMESTAMP(3),
    "error" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaAdsConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "diasSemana" INTEGER[] DEFAULT ARRAY[1]::INTEGER[],
    "cronHour" INTEGER NOT NULL DEFAULT 9,
    "conversationId" TEXT,
    "presupuestoDiario" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "duracionDias" INTEGER NOT NULL DEFAULT 7,
    "objetivo" TEXT NOT NULL DEFAULT 'OUTCOME_TRAFFIC',
    "urlDestino" TEXT,
    "paises" TEXT[] DEFAULT ARRAY['DO']::TEXT[],
    "edadMin" INTEGER NOT NULL DEFAULT 18,
    "edadMax" INTEGER NOT NULL DEFAULT 65,
    "categoriaFinanciera" BOOLEAN NOT NULL DEFAULT false,
    "rotacionDias" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "MetaAdsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdProposal_conversationId_status_idx" ON "AdProposal"("conversationId", "status");

-- CreateIndex
CREATE INDEX "AdProposal_status_createdAt_idx" ON "AdProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AdProposal_mediaId_idx" ON "AdProposal"("mediaId");

-- AddForeignKey
ALTER TABLE "AdProposal" ADD CONSTRAINT "AdProposal_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
