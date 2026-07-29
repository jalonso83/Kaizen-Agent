import { google, drive_v3 } from 'googleapis';
import { config } from '../config';

// ─────────────────────────────────────────────────────────────────────────
// Cliente de Google Drive (Service Account).
//  - Cerebro (lectura): base de conocimiento del agente — marca, decisiones,
//    análisis. FinZen cura la carpeta y la comparte con la service account.
//  - Contenidos (escritura): borradores de contenido que genera el agente.
// Fase 1: indexado del Cerebro + búsqueda por keyword (PRD §1.4, DISENO §9).
// ─────────────────────────────────────────────────────────────────────────

function isConfigured(): boolean {
  const hasCredentials = Boolean(config.drive.serviceAccountPath || config.drive.serviceAccountJsonBase64);
  return hasCredentials && Boolean(config.drive.cerebroFolderId);
}

function driveClient(): drive_v3.Drive {
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

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';
const MAX_DOC_CHARS = 200_000; // ~200KB por doc (DISENO §9)

export interface CerebroFileEntry {
  id: string;
  name: string;
  mimeType: string;
  path: string; // ej. "10-decisiones/pricing" — cadena de carpetas desde la raíz del Cerebro
  modifiedTime: string;
}

async function listFolderRecursive(
  client: drive_v3.Drive,
  folderId: string,
  pathPrefix: string,
): Promise<CerebroFileEntry[]> {
  const res = await client.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    pageSize: 1000,
  });

  const entries: CerebroFileEntry[] = [];
  for (const f of res.data.files ?? []) {
    if (!f.id || !f.name) continue;
    if (f.mimeType === FOLDER_MIME) {
      const subPath = pathPrefix ? `${pathPrefix}/${f.name}` : f.name;
      entries.push(...(await listFolderRecursive(client, f.id, subPath)));
    } else {
      entries.push({ id: f.id, name: f.name, mimeType: f.mimeType ?? '', path: pathPrefix, modifiedTime: f.modifiedTime ?? '' });
    }
  }
  return entries;
}

/** Texto de un archivo del Cerebro, o null si el tipo no se indexa (PDFs — fuera de v1, DISENO §9). */
async function fetchFileText(client: drive_v3.Drive, entry: CerebroFileEntry): Promise<string | null> {
  if (entry.mimeType === DOC_MIME) {
    const res = await client.files.export({ fileId: entry.id, mimeType: 'text/plain' }, { responseType: 'text' });
    return String(res.data).slice(0, MAX_DOC_CHARS);
  }
  if (entry.mimeType === 'text/plain' || entry.mimeType === 'text/markdown' || /\.(md|txt)$/i.test(entry.name)) {
    const res = await client.files.get({ fileId: entry.id, alt: 'media' }, { responseType: 'text' });
    return String(res.data).slice(0, MAX_DOC_CHARS);
  }
  return null;
}

async function findSubfolderId(client: drive_v3.Drive, parentId: string, name: string): Promise<string | null> {
  const escaped = name.replace(/'/g, "\\'");
  const res = await client.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return res.data.files?.[0]?.id ?? null;
}

const CSV_MIME = 'text/csv';

/** Archivo por nombre exacto dentro de una carpeta (para escribir de forma idempotente). */
async function findFileIdByName(client: drive_v3.Drive, folderId: string, name: string): Promise<string | null> {
  const escaped = name.replace(/'/g, "\\'");
  const res = await client.files.list({
    q: `'${folderId}' in parents and name = '${escaped}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return res.data.files?.[0]?.id ?? null;
}

export const drive = {
  isConfigured,

  /** Lista los archivos de la carpeta Cerebro (smoke test — solo raíz, ver check.ts). */
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

  /** Listado RECURSIVO del Cerebro entero (todas las subcarpetas) — base del indexador (DISENO §9). */
  async listCerebroFilesRecursive(): Promise<CerebroFileEntry[]> {
    if (!config.drive.cerebroFolderId) throw new Error('Falta DRIVE_CEREBRO_FOLDER_ID.');
    const client = driveClient();
    return listFolderRecursive(client, config.drive.cerebroFolderId, '');
  },

  /** Texto plano de un archivo del Cerebro (Google Doc exportado, o .md/.txt descargado). null si no se indexa (ej. PDF). */
  async fetchCerebroFileText(entry: CerebroFileEntry): Promise<string | null> {
    const client = driveClient();
    return fetchFileText(client, entry);
  },

  /**
   * Crea un Google Doc en una subcarpeta de Contenidos (reels/guiones/carruseles/assets)
   * a partir de Markdown/texto plano. Sin reintentos (un reintento de escritura puede
   * duplicar un Doc real — misma regla que create_campaign_draft, DISENO §1).
   */
  /**
   * Sube un CSV como archivo CRUDO (sin convertirlo a Google Sheets: lo lee un
   * parser, no una persona). Idempotente por nombre dentro de la carpeta — si
   * el archivo ya existe se REEMPLAZA su contenido en vez de crear un duplicado.
   *
   * Ese upsert es lo que hace seguro reintentar: Drive admite dos archivos con
   * el mismo nombre en la misma carpeta, así que un simple `create` en el
   * segundo intento dejaría dos semanas iguales y el lector no sabría cuál
   * tomar. Cada semana tiene nombre propio, así que no se pisan entre sí.
   */
  async saveCsv(
    folderId: string,
    filename: string,
    content: string,
  ): Promise<{ id: string; link: string; replaced: boolean }> {
    if (!folderId) throw new Error('saveCsv: falta el id de la carpeta destino.');
    const client = driveClient();

    const existingId = await findFileIdByName(client, folderId, filename);
    if (existingId) {
      const res = await client.files.update({
        fileId: existingId,
        media: { mimeType: CSV_MIME, body: content },
        fields: 'id, webViewLink',
      });
      return { id: res.data.id ?? existingId, link: res.data.webViewLink ?? '', replaced: true };
    }

    const res = await client.files.create({
      requestBody: { name: filename, mimeType: CSV_MIME, parents: [folderId] },
      media: { mimeType: CSV_MIME, body: content },
      fields: 'id, webViewLink',
    });
    return { id: res.data.id ?? '', link: res.data.webViewLink ?? '', replaced: false };
  },

  async saveContentDraft(
    folder: 'reels' | 'guiones' | 'carruseles' | 'assets',
    title: string,
    content: string,
  ): Promise<{ id: string; link: string }> {
    if (!config.drive.contenidosFolderId) throw new Error('Falta DRIVE_CONTENIDOS_FOLDER_ID.');
    const client = driveClient();
    const folderId = await findSubfolderId(client, config.drive.contenidosFolderId, folder);
    if (!folderId) {
      throw new Error(`No encontré la subcarpeta "${folder}" dentro de Contenidos en Drive.`);
    }
    const res = await client.files.create({
      requestBody: { name: title, mimeType: DOC_MIME, parents: [folderId] },
      media: { mimeType: 'text/plain', body: content },
      fields: 'id, webViewLink',
    });
    return { id: res.data.id ?? '', link: res.data.webViewLink ?? '' };
  },
};
