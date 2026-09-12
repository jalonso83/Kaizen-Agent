-- CreateTable
CREATE TABLE "InstagramSnapshot" (
    "id" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "leidoEn" TIMESTAMP(3) NOT NULL,
    "seguidores" INTEGER NOT NULL,
    "seguidos" INTEGER NOT NULL,
    "publicacionesTotales" INTEGER NOT NULL,
    "interaccionesPromedio" DOUBLE PRECISION NOT NULL,
    "likesMediana" DOUBLE PRECISION NOT NULL,
    "tasaEngagementPct" DOUBLE PRECISION,
    "insights" JSONB,

    CONSTRAINT "InstagramSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramSnapshot_usuario_fecha_key" ON "InstagramSnapshot"("usuario", "fecha");

-- CreateIndex
CREATE INDEX "InstagramSnapshot_usuario_fecha_idx" ON "InstagramSnapshot"("usuario", "fecha" DESC);
