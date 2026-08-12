-- Día y hora en que corre el resumen semanal, configurables desde la web.
-- Antes eran la constante '0 12 * * 1' (lunes 8am RD) en jobs/weeklySummary.ts.
-- Los defaults reproducen exactamente ese comportamiento, así que las filas
-- existentes no cambian de horario al migrar.
-- cronHour es hora LOCAL de RD (el cron se programa con timezone America/Santo_Domingo).
ALTER TABLE "WeeklySummaryConfig" ADD COLUMN "cronDay" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WeeklySummaryConfig" ADD COLUMN "cronHour" INTEGER NOT NULL DEFAULT 8;
