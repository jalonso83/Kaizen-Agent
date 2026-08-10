import { google, drive_v3 } from 'googleapis';
import { config } from '../config';

// ─────────────────────────────────────────────────────────────────────────
// Cliente de Google Drive.
//  - Cerebro (lectura): base de conocimiento del agente — marca, decisiones,
//    análisis. FinZen cura la carpeta y la comparte.
//  - 50-kaizen/ y Contenidos (escritura): resúmenes, propuestas y borradores.
//
// AUTENTICACIÓN — por qué hay dos vías (2026-08-09):
//
// Se montó con una SERVICE ACCOUNT y leer le funciona bien, pero ESCRIBIR es
// imposible: una service account no tiene cuota de almacenamiento propia, y un
// archivo creado en un "Mi unidad" personal consume la cuota de su dueño. Google
// responde "Service Accounts do not have storage quota" sin importar que tenga
// permiso de Editor. No es un permiso mal puesto: es que ese montaje no puede
// funcionar. Comprobado contra las 3 carpetas reales.
//
// Las salidas que documenta Google —unidades compartidas o delegación de
// dominio— requieren Google Workspace, y finzenai.com tiene el correo en
// GoDaddy. Así que se usa OAUTH DE USUARIO: Kaizen se autentica como la persona
// dueña del Drive y escribe con su cuota. Funciona con una cuenta Gmail normal.
//
// La service account se conserva como respaldo de solo lectura.
// ─────────────────────────────────────────────────────────────────────────

const SCOPES = ['https://www.googleapis.com/auth/drive'];

/** ¿Hay OAuth de usuario completo? Es la única vía que permite ESCRIBIR. */
function hasUserOAuth(): boolean {
  const d = config.drive;
  return Boolean(d.oauthClientId && d.oauthClientSecret && d.oauthRefreshToken);
}

function hasServiceAccount(): boolean {
  return Boolean(config.drive.serviceAccountPath || config.drive.serviceAccountJsonBase64);
}

function hasAnyCredentials(): boolean {
  return hasUserOAuth() || hasServiceAccount();
}

function isConfigured(): boolean {
  return hasAnyCredentials() && Boolean(config.drive.cerebroFolderId);
}

/**
 * Antes esto exigía DRIVE_KAIZEN_FOLDER_ID. Ya no: la carpeta se resuelve por
 * nombre dentro del Cerebro, así que con las credenciales y el ID del Cerebro
 * alcanza. Si la subcarpeta no existiera, el error salta al escribir y dice cuál.
 */
function isKaizenConfigured(): boolean {
  return isConfigured();
}

/** Con qué identidad se está hablando con Drive. Para el smoke test y los errores. */
export function driveAuthMode(): 'oauth-usuario' | 'service-account' | 'sin-configurar' {
  if (hasUserOAuth()) return 'oauth-usuario';
  if (hasServiceAccount()) return 'service-account';
  return 'sin-configurar';
}

const MD_MIME = 'text/markdown';

/** Carpeta por defecto de las notas del agente dentro del Cerebro. */
const DEFAULT_KAIZEN_FOLDER = '50-kaizen';

/** `YYYY-MM-DD-slug.md` — convención de 50-kaizen (README de la carpeta): fecha + slug, un archivo por nota. */
function kaizenFilename(title: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = title
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tildes (forma NFD: letra + marca combinante)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${date}-${slug || 'nota'}.md`;
}

/** Prefiere SIEMPRE el OAuth de usuario; la service account es respaldo de lectura. */
function driveClient(): drive_v3.Drive {
  if (!isConfigured()) {
    throw new Error(
      'Drive no configurado: faltan credenciales (GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN, ' +
      'o GOOGLE_SERVICE_ACCOUNT_PATH/JSON_BASE64) y/o DRIVE_CEREBRO_FOLDER_ID'
    );
  }

  if (hasUserOAuth()) {
    const oauth2 = new google.auth.OAuth2(config.drive.oauthClientId, config.drive.oauthClientSecret);
    // Con el refresh token la librería pide un access token nuevo cuando hace
    // falta; no hay que renovarlo a mano ni persistir nada.
    oauth2.setCredentials({ refresh_token: config.drive.oauthRefreshToken });
    return google.drive({ version: 'v3', auth: oauth2 });
  }

  // Respaldo: service account. Lee bien, pero CUALQUIER escritura va a fallar
  // con "Service Accounts do not have storage quota" — ver la nota de arriba.
  // Railway: el JSON viaja en base64 por env var. Local: path al archivo.
  const auth = config.drive.serviceAccountJsonBase64
    ? new google.auth.GoogleAuth({
        credentials: JSON.parse(Buffer.from(config.drive.serviceAccountJsonBase64, 'base64').toString('utf8')),
        scopes: SCOPES,
      })
    : new google.auth.GoogleAuth({ keyFile: config.drive.serviceAccountPath, scopes: SCOPES });
  return google.drive({ version: 'v3', auth });
}

/**
 * Envuelve una escritura para que, si falla por la limitación de cuota de la
 * service account, el error diga QUÉ hacer en vez del mensaje críptico de Google.
 */
async function conErrorDeEscrituraClaro<T>(operacion: () => Promise<T>): Promise<T> {
  try {
    return await operacion();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/storage quota/i.test(msg)) {
      throw new Error(
        'Drive rechazó la escritura porque se está usando una SERVICE ACCOUNT, y esas no pueden ' +
        'crear archivos en un Drive personal (no tienen cuota). Configura el OAuth de usuario: ' +
        'GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET y GOOGLE_OAUTH_REFRESH_TOKEN ' +
        '(genera el token con `npm run drive:auth`).'
      );
    }
    throw e;
  }
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
  isKaizenConfigured,

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
      const res = await conErrorDeEscrituraClaro(() => client.files.update({
        fileId: existingId,
        media: { mimeType: CSV_MIME, body: content },
        fields: 'id, webViewLink',
      }));
      return { id: res.data.id ?? existingId, link: res.data.webViewLink ?? '', replaced: true };
    }

    const res = await conErrorDeEscrituraClaro(() => client.files.create({
      requestBody: { name: filename, mimeType: CSV_MIME, parents: [folderId] },
      media: { mimeType: CSV_MIME, body: content },
      fields: 'id, webViewLink',
    }));
    return { id: res.data.id ?? '', link: res.data.webViewLink ?? '', replaced: false };
  },

  /** Borra un archivo. Lo usa el smoke test para limpiar su archivo de prueba. */
  async deleteFile(fileId: string): Promise<void> {
    const client = driveClient();
    await client.files.delete({ fileId });
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
    const res = await conErrorDeEscrituraClaro(() => client.files.create({
      requestBody: { name: title, mimeType: DOC_MIME, parents: [folderId] },
      media: { mimeType: 'text/plain', body: content },
      fields: 'id, webViewLink',
    }));
    return { id: res.data.id ?? '', link: res.data.webViewLink ?? '' };
  },

  /**
   * Guarda una nota en 50-kaizen/ — la ÚNICA carpeta del Cerebro donde Kaizen
   * puede escribir (README de la carpeta, 2026-07-11). Archivo .md plano
   * directo en esa carpeta (sin subcarpetas, a diferencia de Contenidos), con
   * el nombre `YYYY-MM-DD-slug.md` que exige esa misma convención.
   */
  async saveCerebroNote(
    title: string,
    content: string,
    subcarpeta?: string,
  ): Promise<{ id: string; link: string; carpeta: string }> {
    const client = driveClient();

    // Destino: la subcarpeta pedida, o 50-kaizen por defecto, o la raíz del
    // Cerebro si tampoco hay 50-kaizen configurado.
    //
    // La escritura ya NO está limitada a 50-kaizen (decisión 2026-08-09): con
    // OAuth de usuario, Kaizen escribe con la cuenta del dueño del Drive, así
    // que puede crear en cualquier parte del Cerebro. El valor por defecto se
    // mantiene en 50-kaizen para que el resumen semanal y las propuestas sigan
    // cayendo donde el socio ya los busca los lunes.
    if (!config.drive.cerebroFolderId) throw new Error('Falta DRIVE_CEREBRO_FOLDER_ID.');

    const nombreCarpeta = subcarpeta || DEFAULT_KAIZEN_FOLDER;

    // Se resuelve POR NOMBRE dentro del Cerebro, igual que saveContentDraft hace
    // con las subcarpetas de Contenidos. Antes esto exigía un DRIVE_KAIZEN_FOLDER_ID
    // a mano — una variable que nadie puso nunca y que habría hecho fallar el
    // resumen semanal igual, aunque los permisos hubieran estado bien.
    // `kaizenFolderId` se conserva solo como atajo opcional: si está, evita esta
    // búsqueda; si no, no pasa nada.
    let destino: string | null = null;
    if (!subcarpeta && config.drive.kaizenFolderId) {
      destino = config.drive.kaizenFolderId;
    } else {
      destino = await findSubfolderId(client, config.drive.cerebroFolderId, nombreCarpeta);
    }

    if (!destino) {
      throw new Error(
        `No existe la subcarpeta "${nombreCarpeta}" en el Cerebro. ` +
        (subcarpeta
          ? 'Usa list_cerebro_folders para ver las que existen.'
          : 'Créala en Drive o pasa otra subcarpeta.')
      );
    }

    const res = await conErrorDeEscrituraClaro(() => client.files.create({
      requestBody: { name: kaizenFilename(title), mimeType: MD_MIME, parents: [destino!] },
      media: { mimeType: MD_MIME, body: content },
      fields: 'id, webViewLink',
    }));
    return { id: res.data.id ?? '', link: res.data.webViewLink ?? '', carpeta: nombreCarpeta };
  },

  /** Subcarpetas de primer nivel del Cerebro — para que el agente sepa dónde puede escribir. */
  async listCerebroSubfolders(): Promise<string[]> {
    if (!config.drive.cerebroFolderId) throw new Error('Falta DRIVE_CEREBRO_FOLDER_ID.');
    const client = driveClient();
    const res = await client.files.list({
      q: `'${config.drive.cerebroFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(name)',
      pageSize: 200,
    });
    return (res.data.files ?? []).map((f) => f.name ?? '').filter(Boolean).sort();
  },
};
