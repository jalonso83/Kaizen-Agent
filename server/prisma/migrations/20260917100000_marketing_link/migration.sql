-- CreateTable
CREATE TABLE "MarketingLink" (
    "clave" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "MarketingLink_pkey" PRIMARY KEY ("clave")
);
