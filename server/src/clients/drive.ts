import { google } from 'googleapis';
import { config } from '../config';

// ─────────────────────────────────────────────────────────────────────────
// Cliente de Google Drive (Service Account).
//  - Cerebro (lectura): base de conocimiento del agente — marca, decisiones,
//    análisis. FinZen cura la carpeta y la comparte con la service account.
//  - Contenidos (escritura): borradores de contenido que genera el agente.
// Fase 1: indexado del Cerebro + búsqueda por keyword (PRD §1.4).
// ─────────────────────────────────────────────────────────────────────────

function isConfigured(): boolean {
  const hasCredentials = Boolean(config.drive.serviceAccountPath || config.drive.serviceAccountJsonBase64);
  return hasCredentials && Boolean(config.drive.cerebroFolderId);
}

function driveClient() {
  if (!isConfigured()) {
    throw new Error(
      'Drive no configurado: faltan credenciales (GOOGLE_SERVICE_ACCOUNT_PATH o GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) y/o DRIVE_CEREBRO_FOLDER_ID'
    );
  }
  const scopes = ['https://www.googleapis.com/auth/drive'];
  // Railway: el JSON viaja en base64 por env var. Local: path al archivo.
  const auth = config.drive.serviceAccountJsonBase64
    ? new google.auth.GoogleAuth({
        credentials: JSON.parse(Buffer.from(config.drive.serviceAccountJsonBase64, 'base64').toString('utf8')),
        scopes,
      })
    : new google.auth.GoogleAuth({ keyFile: config.drive.serviceAccountPath, scopes });
  return google.drive({ version: 'v3', auth });
}

export const drive = {
  isConfigured,

  /** Lista los archivos de la carpeta Cerebro (smoke test + base del indexado). */
  async listCerebroFiles(): Promise<Array<{ id: string; name: string; mimeType: string }>> {
    const client = driveClient();
    const res = await client.files.list({
      q: `'${config.drive.cerebroFolderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType)',
      pageSize: 100,
    });
    return (res.data.files ?? []).map((f) => ({
      id: f.id ?? '',
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
    }));
  },
};
