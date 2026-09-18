-- CreateTable
CREATE TABLE "TiktokCredential" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "accessExpiresAt" TIMESTAMP(3),
    "refreshExpiresAt" TIMESTAMP(3),
    "openId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TiktokCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TiktokSnapshot" (
    "id" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "leidoEn" TIMESTAMP(3) NOT NULL,
    "seguidores" INTEGER NOT NULL,
    "seguidos" INTEGER NOT NULL,
    "likesTotales" INTEGER NOT NULL,
    "videosTotales" INTEGER NOT NULL,
    "viewsMediana" DOUBLE PRECISION NOT NULL,
    "interaccionesPromedio" DOUBLE PRECISION NOT NULL,
    "tasaEngagementPct" DOUBLE PRECISION,

    CONSTRAINT "TiktokSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TiktokSnapshot_usuario_fecha_key" ON "TiktokSnapshot"("usuario", "fecha");

-- CreateIndex
CREATE INDEX "TiktokSnapshot_usuario_fecha_idx" ON "TiktokSnapshot"("usuario", "fecha" DESC);
