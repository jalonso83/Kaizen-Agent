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
// 3 era muy poco margen: alcanzaba con que tres documentos grandes mencionaran
// los términos de pasada para que el relevante quedara afuera, sin segunda
// oportunidad. Cuesta ~1.900 tokens de contexto por búsqueda en vez de ~1.100.
const MAX_RESULTS = 5;
export const FOLDERS = ['reels', 'guiones', 'carruseles', 'assets'] as const;
type ContentFolder = (typeof FOLDERS)[number];

interface CerebroRow {
  name: string;
  path: string;
  text: string;
  /** Fecha de modificación en Drive (ISO). Lo que permite distinguir dos fuentes que se contradicen. */
  modifiedTime: string;
}

/**
 * Aviso que viaja CON el resultado, no solo en el system prompt (mismo patrón
 * que kpis.ts). El caso real que lo motiva: el Diagnóstico de Activación (jul)
 * dice CAC $79 y las notas de umbrales (ago) dicen $142.88. Los dos son
 * correctos en su ventana, pero sin la fecha al lado el modelo elegía el que
 * ganara en el ranking y nadie sabía cuál había usado.
 */
const FECHAS_NOTE =
  'OJO: los documentos del Cerebro cubren VENTANAS DE TIEMPO DISTINTAS y algunos se contradicen entre sí por eso. ' +
  'Cada resultado trae "fecha" (cuándo se MODIFICÓ el archivo en Drive) y, si el documento la declara, "ventana" (el período que cubren SUS CIFRAS). ' +
  'No son lo mismo y la que importa para comparar cifras es "ventana": una nota con datos de julio editada en agosto tiene fecha de agosto. ' +
  'Si un documento NO trae "ventana", no asumas que sus cifras son de la fecha del archivo — dilo como lo que es: ventana no declarada. ' +
  'Al citar cualquier cifra del negocio que salga de acá, di SIEMPRE de qué documento sale y de qué ventana. ' +
  'Si dos documentos dan números distintos para lo mismo, NO elijas uno: reporta ambos con su ventana y di que discrepan — ' +
  'lo más probable es que midan períodos o denominadores distintos, y eso es información, no un error.';

/** "24 de julio de 2026" — el modelo cita fechas, no timestamps. */
function fechaLegible(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Ventana de datos declarada en el encabezado del documento (convención de
 * `docs/cerebro/README.md`): una línea `Ventana de datos: ...` entre las
 * primeras del texto.
 *
 * Por qué hace falta habiendo ya `fecha`: la fecha de Drive dice cuándo se
 * EDITÓ el archivo, no de cuándo son sus datos. El caso real: el Diagnóstico de
 * Activación (cifras acumuladas abr–jul) y las notas de Junior (CAC marginal de
 * julio) dan CAC de $79 y $142.88 — los dos correctos, con denominadores
 * distintos. Con solo la fecha, el modelo los lee como dos mediciones de lo
 * mismo separadas por tres semanas, que es exactamente la lectura equivocada.
 *
 * Se acepta `Ventana`, `Ventana de datos`, `Período`/`Periodo` y `Cubre`, con o
 * sin negritas de Markdown. Un documento sin la línea devuelve `undefined` y se
 * comporta igual que antes — la convención se adopta documento por documento,
 * no de golpe.
 */
const VENTANA_RE = /^[\s>*_-]*\**\s*(?:ventana(?:\s+de\s+datos)?|per[ií]odo|cubre)\s*\**\s*:\s*(.+?)\s*$/im;
/** Solo el encabezado: más abajo, "Período:" suele ser parte del contenido, no del documento. */
const VENTANA_SCAN_CHARS = 800;

export function ventanaDeclarada(text: string): string | undefined {
  const match = VENTANA_RE.exec(text.slice(0, VENTANA_SCAN_CHARS));
  if (!match) return undefined;
  const ventana = match[1].replace(/\*+/g, '').trim();
  if (!ventana) return undefined;
  return ventana.length > 200 ? `${ventana.slice(0, 200)}…` : ventana;
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
  ambito: 'comun',
  description:
    'Busca en el Cerebro de FinZen (Drive: marca, decisiones, análisis) por palabras clave. Devuelve hasta 5 documentos con un fragmento relevante, su nombre/ruta como fuente, la FECHA en que se modificó el archivo y la VENTANA de datos que el documento declara (o "no declarada"). ' +
    'Los documentos del Cerebro cubren ventanas de tiempo distintas y algunos se contradicen por eso: al citar una cifra de acá, di siempre de qué documento sale y de qué ventana — no de la fecha del archivo, que es cuándo se editó y no de cuándo son sus datos. ' +
    'Úsala SIEMPRE antes de redactar el mensaje de una campaña o contenido (para el tono de marca) y ante preguntas sobre decisiones o contexto del negocio que no salen de los KPIs. ' +
    'Es una búsqueda por palabras clave, no una lista completa: si los resultados no tienen que ver con lo que buscabas, significa que la consulta no dio en el blanco, NO que el documento no exista. ' +
    'Reformula con otros términos (más específicos, o el nombre del archivo) antes de afirmarle al socio que algo no está en el Cerebro.',
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

    // El tercer argumento de ts_rank (1) divide el puntaje por 1+log(largo del
    // documento). Sin él —el default— el ranking premia el VOLUMEN de
    // coincidencias, así que un digest de 71 KB que menciona los términos de
    // pasada le gana a la nota corta que trata justamente de eso. Junto con el
    // setweight del nombre (manual.sql) es lo que hace que una búsqueda por el
    // nombre del archivo encuentre el archivo.
    // 'es_kaizen' y no 'spanish': es la configuración con unaccent que define la
    // migración 20260821120000. TIENE que ser la misma con la que se construyó
    // la columna tsv — si el índice normaliza acentos y la consulta no, buscar
    // "activación" no encuentra un documento que dice "activacion".
    const rows = await db.$queryRaw<CerebroRow[]>`
      SELECT name, path, text, "modifiedTime"
      FROM "CerebroDoc"
      WHERE tsv @@ plainto_tsquery('es_kaizen', ${query})
      ORDER BY ts_rank(tsv, plainto_tsquery('es_kaizen', ${query}), 1) DESC
      LIMIT ${MAX_RESULTS}
    `;

    // El respaldo por ILIKE corre cuando la búsqueda principal quedó CORTA, no
    // solo cuando devolvió cero. Antes exigía cero filas y por eso nunca se
    // activaba en el caso que importa: tres resultados flojos lo desarmaban
    // igual de bien que tres buenos.
    if (rows.length < MAX_RESULTS) {
      const yaEsta = new Set(rows.map((r) => `${r.path}/${r.name}`));
      const extra = await db.$queryRaw<CerebroRow[]>`
        SELECT name, path, text, "modifiedTime"
        FROM "CerebroDoc"
        WHERE name ILIKE ${`%${query}%`} OR text ILIKE ${`%${query}%`}
        LIMIT ${MAX_RESULTS}
      `;
      for (const r of extra) {
        if (rows.length >= MAX_RESULTS) break;
        if (!yaEsta.has(`${r.path}/${r.name}`)) rows.push(r);
      }
    }

    if (rows.length === 0) {
      return JSON.stringify({ results: [], note: 'Sin coincidencias. Prueba palabras clave más generales.' });
    }

    // La ventana se busca en el texto COMPLETO del documento (el encabezado),
    // no en el fragmento: el fragmento está centrado en el match de la búsqueda
    // y casi nunca incluye las primeras líneas.
    const results = rows.map((r) => ({
      name: r.name,
      path: r.path,
      fecha: fechaLegible(r.modifiedTime),
      ventana: ventanaDeclarada(r.text) ?? 'no declarada',
      fragment: extractFragment(r.text, query),
    }));
    return [FECHAS_NOTE, JSON.stringify({ results })].join('\n');
  },
};

export const saveContentDraftTool: KaizenTool = {
  name: 'save_content_draft',
  ambito: 'marketing',
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
  ambito: 'comun',
  description:
    'Guarda una nota (Markdown) en el Cerebro. Por defecto va a 50-kaizen/, que es donde el socio revisa los lunes: úsala así para el resumen semanal, propuestas de campaña en texto y discrepancias de datos. ' +
    'Si la nota pertenece claramente a otra sección del Cerebro, pasa "subcarpeta" con el nombre exacto de una subcarpeta existente (puedes consultarlas con list_cerebro_folders). NUNCA la uses para contenido de redes: eso es save_content_draft, que va a Contenidos. ' +
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
  ambito: 'comun',
  description:
    'Lista las subcarpetas del Cerebro. Úsala ANTES de save_cerebro_note cuando quieras guardar algo fuera de 50-kaizen/, para pasar un nombre de carpeta que exista de verdad.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute() {
    const carpetas = await drive.listCerebroSubfolders();
    if (carpetas.length === 0) return 'El Cerebro no tiene subcarpetas.';
    return `Subcarpetas del Cerebro: ${carpetas.join(', ')}`;
  },
};
