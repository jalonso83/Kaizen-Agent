import { db } from '../../db';
import { drive } from '../../clients/drive';
import type { KaizenTool } from './guard';

// ─────────────────────────────────────────────────────────────────────────
// Las tools del Cerebro — DISENO_FASE1.md §9. search_cerebro lee el índice
// FTS local (nunca llama a Drive en vivo — eso lo hace el indexador de fondo,
// jobs/cerebroIndex.ts); save_content_draft SÍ escribe a Drive, directo, sin
// reintentos (misma regla que create_campaign_draft: un reintento de
// escritura puede duplicar un Doc real).
// ─────────────────────────────────────────────────────────────────────────

const FRAGMENT_CHARS = 1500;
const FOLDERS = ['reels', 'guiones', 'carruseles', 'assets'] as const;
type ContentFolder = (typeof FOLDERS)[number];

interface CerebroRow {
  name: string;
  path: string;
  text: string;
}

/** Fragmento de ~1500 chars centrado en la primera palabra de la query que aparece en el texto. */
function extractFragment(text: string, query: string): string {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  let matchIndex = -1;
  for (const w of words) {
    const idx = lower.indexOf(w);
    if (idx !== -1 && (matchIndex === -1 || idx < matchIndex)) matchIndex = idx;
  }
  if (matchIndex === -1) matchIndex = 0;

  const half = Math.floor(FRAGMENT_CHARS / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(text.length, start + FRAGMENT_CHARS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export const searchCerebroTool: KaizenTool = {
  name: 'search_cerebro',
  description:
    'Busca en el Cerebro de FinZen (Drive: marca, decisiones, análisis) por palabras clave. Devuelve hasta 3 documentos con un fragmento relevante y su nombre/ruta como fuente. ' +
    'Úsala SIEMPRE antes de redactar el mensaje de una campaña o contenido (para el tono de marca) y ante preguntas sobre decisiones o contexto del negocio que no salen de los KPIs.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Palabras clave a buscar (español)' },
    },
    required: ['query'],
  },
  async execute(input) {
    const query = (input.query as string | undefined)?.trim();
    if (!query) {
      throw new Error('Falta "query".');
    }

    let rows = await db.$queryRaw<CerebroRow[]>`
      SELECT name, path, text
      FROM "CerebroDoc"
      WHERE tsv @@ plainto_tsquery('spanish', ${query})
      ORDER BY ts_rank(tsv, plainto_tsquery('spanish', ${query})) DESC
      LIMIT 3
    `;

    if (rows.length === 0) {
      // Fallback: el tsquery no matcheó nada (ej. una sola palabra rara) — probar ILIKE simple.
      rows = await db.$queryRaw<CerebroRow[]>`
        SELECT name, path, text
        FROM "CerebroDoc"
        WHERE name ILIKE ${`%${query}%`} OR text ILIKE ${`%${query}%`}
        LIMIT 3
      `;
    }

    if (rows.length === 0) {
      return JSON.stringify({ results: [], note: 'Sin coincidencias. Prueba palabras clave más generales.' });
    }

    const results = rows.map((r) => ({ name: r.name, path: r.path, fragment: extractFragment(r.text, query) }));
    return JSON.stringify({ results });
  },
};

export const saveContentDraftTool: KaizenTool = {
  name: 'save_content_draft',
  description:
    'Guarda contenido (Markdown) como un Google Doc en la carpeta Contenidos de FinZen. Úsala para conceptos de contenido, guiones, o el resumen semanal — nunca para campañas (eso es propose_campaign/create_campaign_draft). ' +
    'Sin reintentos: si falla, no la reintentes automáticamente, avisa al socio.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título del documento' },
      folder: { type: 'string', enum: [...FOLDERS], description: 'Subcarpeta de Contenidos donde guardarlo' },
      content: { type: 'string', description: 'Contenido en Markdown' },
    },
    required: ['title', 'folder', 'content'],
  },
  async execute(input) {
    const title = (input.title as string | undefined)?.trim();
    const folder = input.folder as string | undefined;
    const content = input.content as string | undefined;

    if (!title) {
      throw new Error('Falta "title".');
    }
    if (!folder || !FOLDERS.includes(folder as ContentFolder)) {
      throw new Error(`"folder" debe ser uno de: ${FOLDERS.join(', ')}.`);
    }
    if (!content || content.trim().length === 0) {
      throw new Error('Falta "content".');
    }
    if (!drive.isConfigured()) {
      throw new Error('Drive no está configurado en este ambiente — no se puede guardar contenido. Avisa al socio.');
    }

    const result = await drive.saveContentDraft(folder as ContentFolder, title, content);
    return `Guardado en Contenidos/${folder}: ${result.link}`;
  },
};

export const saveCerebroNoteTool: KaizenTool = {
  name: 'save_cerebro_note',
  description:
    'Guarda una nota (Markdown) en el Cerebro. Por defecto va a 50-kaizen/, que es donde el socio revisa los lunes: úsala así para el resumen semanal, propuestas de campaña en texto y discrepancias de datos. ' +
    'Si la nota pertenece claramente a otra sección del Cerebro, pasá "subcarpeta" con el nombre exacto de una subcarpeta existente (podés consultarlas con list_cerebro_folders). NUNCA la uses para contenido de redes: eso es save_content_draft, que va a Contenidos. ' +
    'El archivo se nombra automáticamente "YYYY-MM-DD-<title>.md" (hoy). Sin reintentos: si falla, no la reintentes automáticamente, avisa al socio.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Slug corto del archivo (se usa tal cual en el nombre, ej. "resumen-semanal"; se le antepone la fecha de hoy)' },
      content: { type: 'string', description: 'Contenido en Markdown' },
      subcarpeta: { type: 'string', description: 'Opcional. Nombre exacto de una subcarpeta EXISTENTE del Cerebro (ej. "10-decisiones"). Si se omite, la nota va a 50-kaizen/.' },
    },
    required: ['title', 'content'],
  },
  async execute(input) {
    const title = (input.title as string | undefined)?.trim();
    const content = input.content as string | undefined;

    if (!title) {
      throw new Error('Falta "title".');
    }
    if (!content || content.trim().length === 0) {
      throw new Error('Falta "content".');
    }
    const subcarpeta = (input.subcarpeta as string | undefined)?.trim() || undefined;

    if (!subcarpeta && !drive.isKaizenConfigured()) {
      throw new Error('50-kaizen no está configurado en este ambiente (falta DRIVE_KAIZEN_FOLDER_ID o las credenciales de Drive) — no se puede guardar la nota. Avisa al socio.');
    }

    const result = await drive.saveCerebroNote(title, content, subcarpeta);
    return `Guardado en ${result.carpeta}: ${result.link}`;
  },
};

/**
 * Sin esto, para escribir fuera de 50-kaizen el agente tendría que ADIVINAR el
 * nombre de una subcarpeta, y `saveCerebroNote` rechaza las que no existen. Le
 * damos la lista para que elija de verdad en vez de inventar.
 */
export const listCerebroFoldersTool: KaizenTool = {
  name: 'list_cerebro_folders',
  description:
    'Lista las subcarpetas del Cerebro. Úsala ANTES de save_cerebro_note cuando quieras guardar algo fuera de 50-kaizen/, para pasar un nombre de carpeta que exista de verdad.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute() {
    const carpetas = await drive.listCerebroSubfolders();
    if (carpetas.length === 0) return 'El Cerebro no tiene subcarpetas.';
    return `Subcarpetas del Cerebro: ${carpetas.join(', ')}`;
  },
};
