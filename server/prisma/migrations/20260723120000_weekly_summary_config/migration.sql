CREATE TABLE "WeeklySummaryConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "weekMode" TEXT NOT NULL DEFAULT 'calendar',
    "weekStartDay" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "WeeklySummaryConfig_pkey" PRIMARY KEY ("id")
);
