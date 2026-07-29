import { getAcquisitionWindow, type AcquisitionWindowResponse } from '../clients/finzenApi';

// ─────────────────────────────────────────────────────────────────────────
// Export semanal de adquisición para el reporte de KPIs sociales.
//
// Lee la ventana semanal de FinZen (Agent API) y arma el CSV. NO lo guarda:
// el destino se decide aparte y se le pasa el artefacto ya listo. Así el
// formato del archivo —que es un contrato con el lector automático del
// reporte— vive en un solo lugar y no depende de dónde termine el archivo.
//
// CONTRATO DEL ARCHIVO (encargo 2026-07-25). Congelado desde el primer
// archivo publicado: cualquier cambio de nombre, columnas u orden hay que
// avisarlo ANTES de aplicarlo, para ajustar el lector el mismo día.
//   nombre   : adquisicion-YYYY-MM-DD.csv  (la fecha es el LUNES de la corrida)
//   columnas : window_start, window_end, source, campaign, medium, leads,
//              visitors, registros
//
// Sobre `registros`: es leads ÚNICOS por identidad, la misma definición de la
// columna "Registros" del dashboard de adquisición de FinZen. NO es el evento
// CompleteRegistration (ese se dispara desde la app móvil sin UTMs, así que no
// se puede atribuir a una red). Se conserva el nombre del dashboard para que
// los números se puedan cotejar contra la pantalla sin traducir vocabulario.
//
// Sin columnas de dinero: el encargo pide solo adquisición.
// ─────────────────────────────────────────────────────────────────────────

export const ACQUISITION_CSV_COLUMNS = [
  'window_start',
  'window_end',
  'source',
  'campaign',
  'medium',
  'leads',
  'visitors',
  'registros',
] as const;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AcquisitionExportArtifact {
  /** Nombre del archivo según el contrato: adquisicion-<lunes>.csv */
  filename: string;
  /** Contenido completo del CSV, listo para escribir tal cual. */
  csv: string;
  /** Ventana efectiva que devolvió FinZen (días inclusivos, hora RD). */
  window: { start: string; end: string; timezone: string };
  /** Filas de datos, sin contar el encabezado. 0 es un resultado válido. */
  rowCount: number;
}

/**
 * Escapa un valor según RFC 4180: entrecomilla si trae coma, comilla, salto de
 * línea o espacios en los bordes, y duplica las comillas internas. Los nombres
 * de campaña vienen de UTMs escritos a mano, así que esto no es teórico.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (raw.length === 0) return '';
  const needsQuoting = /[",\r\n]/.test(raw) || raw !== raw.trim();
  return needsQuoting ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/**
 * Nombre del archivo: el LUNES de la corrida, o sea el día siguiente al cierre
 * de la ventana (que siempre termina en domingo). Se deriva de la ventana y no
 * de "hoy" a propósito: si el job se cae el lunes y se recupera el martes, el
 * archivo conserva el nombre que le tocaba en vez de correrse un día.
 */
export function exportFilename(windowEnd: string): string {
  if (!DATE_ONLY_RE.test(windowEnd)) {
    throw new Error(`Fecha de cierre de ventana inválida: "${windowEnd}" (se esperaba YYYY-MM-DD)`);
  }
  const monday = new Date(`${windowEnd}T00:00:00Z`);
  if (Number.isNaN(monday.getTime())) {
    throw new Error(`Fecha de cierre de ventana inválida: "${windowEnd}"`);
  }
  monday.setUTCDate(monday.getUTCDate() + 1);
  return `adquisicion-${monday.toISOString().slice(0, 10)}.csv`;
}

/**
 * Serializa la respuesta de FinZen al CSV del contrato. Salto de línea CRLF
 * (RFC 4180) y SIN BOM: el archivo lo lee un parser, no Excel, y un BOM haría
 * que la primera columna llegue como "﻿window_start" a un lector ingenuo.
 */
export function toCsv(data: AcquisitionWindowResponse): string {
  const lines = [ACQUISITION_CSV_COLUMNS.join(',')];

  for (const row of data.rows) {
    lines.push(
      [
        csvCell(data.window.start),
        csvCell(data.window.end),
        csvCell(row.source),
        csvCell(row.campaign),
        csvCell(row.medium),
        csvCell(row.leads),
        csvCell(row.visitors),
        csvCell(row.leads_unicos),
      ].join(','),
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Arma el export de la semana. Sin parámetros toma la última semana completa
 * lunes→domingo, calculada por FinZen en hora RD (ver getAcquisitionWindow).
 *
 * Una semana sin datos devuelve el CSV con solo el encabezado, y eso hay que
 * publicarlo igual: un archivo vacío dice "corrí y no hubo nada", mientras que
 * un archivo ausente es indistinguible de un job caído.
 */
export async function buildWeeklyAcquisitionExport(params?: {
  from?: string;
  to?: string;
}): Promise<AcquisitionExportArtifact> {
  const data = await getAcquisitionWindow(params);

  if (!data?.window?.start || !data?.window?.end) {
    throw new Error('FinZen devolvió una respuesta sin ventana (window.start/end) — no se puede nombrar el archivo.');
  }

  return {
    filename: exportFilename(data.window.end),
    csv: toCsv(data),
    window: data.window,
    rowCount: data.rows?.length ?? 0,
  };
}
