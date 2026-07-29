import cron from 'node-cron';
import { config } from '../config';
import { drive } from '../clients/drive';
import { buildWeeklyAcquisitionExport } from '../services/acquisitionExport';

// ─────────────────────────────────────────────────────────────────────────
// Export semanal de adquisición → Drive. Alimenta el reporte de KPIs sociales
// (encargo 2026-07-25): lee la ventana de la semana en FinZen, arma el CSV
// (services/acquisitionExport.ts, ahí vive el contrato del archivo) y lo sube.
//
// LUNES, no domingo en la noche. El corte de semana lo calcula FinZen como
// "última semana COMPLETA lunes→domingo en hora RD": si esto corriera un
// domingo, esa semana todavía no terminó y devolvería la ANTERIOR — un reporte
// viejo, sin ningún error visible. El encargo ofrecía las dos ventanas; esta es
// la única que no se equivoca sola.
//
// Corre a la 1:00am RD y el reporte de Junior a las 7:30am: 6h de colchón para
// que un fallo se pueda ver y reintentar a mano antes de que alguien lo lea.
//
// Tolerante a fallos por diseño: si una semana no sale, el reporte lo declara y
// sigue. Por eso acá nada se reintenta en bucle ni tumba el proceso.
// ─────────────────────────────────────────────────────────────────────────

const CRON_SCHEDULE = '0 5 * * 1'; // lunes 05:00 UTC = 1:00am RD (UTC-4)

/** Carpeta destino: la configurada o, provisionalmente, la raíz del Cerebro. */
function resolveFolderId(): string | undefined {
  return config.drive.acquisitionExportFolderId ?? config.drive.cerebroFolderId;
}

export interface AcquisitionExportResult {
  filename: string;
  window: { start: string; end: string };
  rowCount: number;
  link: string;
  replaced: boolean;
}

/**
 * Corrida del export. Sin parámetros toma la última semana completa (la calcula
 * FinZen en hora RD). `from`/`to` son para recuperar una semana puntual a mano.
 */
export async function runAcquisitionExport(params?: {
  from?: string;
  to?: string;
}): Promise<AcquisitionExportResult | null> {
  if (!drive.isConfigured()) {
    console.warn('[acquisition-export] Drive no configurado — se omite la corrida.');
    return null;
  }

  const folderId = resolveFolderId();
  if (!folderId) {
    console.warn('[acquisition-export] Sin carpeta destino (DRIVE_ACQUISITION_EXPORT_FOLDER_ID ni DRIVE_CEREBRO_FOLDER_ID) — se omite.');
    return null;
  }

  const startedAt = Date.now();
  try {
    const artifact = await buildWeeklyAcquisitionExport(params);

    // Una semana sin filas se publica igual: un archivo vacío dice "corrí y no
    // hubo nada", mientras que un archivo ausente es indistinguible de un job
    // caído. Se avisa en el log para que no pase desapercibido.
    if (artifact.rowCount === 0) {
      console.warn(
        `[acquisition-export] La semana ${artifact.window.start} a ${artifact.window.end} no trajo filas — se sube el CSV solo con encabezado.`,
      );
    }

    const saved = await drive.saveCsv(folderId, artifact.filename, artifact.csv);

    console.log(
      `[acquisition-export] listo en ${Date.now() - startedAt}ms — ${artifact.filename} ` +
        `(${artifact.rowCount} filas, semana ${artifact.window.start} a ${artifact.window.end})` +
        `${saved.replaced ? ' [reemplazado]' : ''}.`,
    );

    return {
      filename: artifact.filename,
      window: { start: artifact.window.start, end: artifact.window.end },
      rowCount: artifact.rowCount,
      link: saved.link,
      replaced: saved.replaced,
    };
  } catch (err) {
    console.error('[acquisition-export] Falló la corrida:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Programa la corrida (lunes 1am RD). No corre nada al llamarla — solo agenda. */
export function startAcquisitionExportCron(): void {
  cron.schedule(CRON_SCHEDULE, () => void runAcquisitionExport(), { timezone: 'UTC' });
}
