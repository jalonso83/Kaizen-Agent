import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { extractText, getDocumentProxy } from 'unpdf';
import { SinTextoError, type Extraccion } from './extraccion';
import { describirImagen, esImagen } from './vision';

// ─────────────────────────────────────────────────────────────────────────
// Extracción de texto de documentos binarios del Cerebro.
//
// Hasta 2026-08-25 el indexador solo leía Google Docs y .md/.txt: todo lo demás
// se contaba como "omitido" y quedaba invisible para Kaizen. Eso dejó fuera los
// 8 documentos de marca que marketing subió el 18-ago (todos PDF) y los CSV
// semanales de adquisición.
//
// LA REGLA QUE ORDENA ESTE MÓDULO: un archivo del que no se pudo sacar texto
// NUNCA se indexa como si estuviera vacío. Un PDF escaneado, un Excel sin celdas
// o un docx corrupto devuelven `null` con motivo, y el indexador los cuenta
// aparte. Indexar un documento vacío es peor que no indexarlo: la búsqueda lo
// devuelve, el modelo lo cita y no dice nada — y nadie se entera.
//
// (Es el mismo patrón que ya mordió cuatro veces en este proyecto: el error se
// registra en un warning que nadie mira y el sistema sigue como si nada.)
// ─────────────────────────────────────────────────────────────────────────

/** Tope por documento, alineado con MAX_DOC_CHARS de drive.ts (DISENO §9). */
const MAX_CHARS = 200_000;

/** Filas por hoja de cálculo. Una hoja de 50k filas no cabe ni aporta. */
const MAX_FILAS = 2_000;

/** Páginas de PDF. Los reportes del negocio son de 5-20; 200 es un tope de cordura. */
const MAX_PAGINAS = 200;

// El contrato vive en su propio módulo para que vision.ts pueda usarlo sin que
// los dos se importen mutuamente. Se re-exporta para no cambiarle el import a
// nadie (drive.ts, jobs/cerebroIndex.ts).
export { SinTextoError, type Extraccion };

function recortar(texto: string, via: string): Extraccion {
  if (texto.length <= MAX_CHARS) return { texto, via };
  return {
    texto: texto.slice(0, MAX_CHARS),
    via,
    aviso: `Documento truncado a ${MAX_CHARS.toLocaleString('es-DO')} caracteres; el original tiene ${texto.length.toLocaleString('es-DO')}.`,
  };
}

/** Colapsa el espacio en blanco que dejan los extractores sin cambiar el contenido. */
function limpiar(texto: string): string {
  return texto
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── PDF ───────────────────────────────────────────────────────────────────

/**
 * Un PDF escaneado es una imagen: pdf.js devuelve cadena vacía y no hay error.
 * Sin este chequeo se indexaría un documento en blanco que la búsqueda devuelve
 * y el modelo cita como si tuviera contenido.
 */
async function dePdf(datos: Uint8Array): Promise<Extraccion> {
  const pdf = await getDocumentProxy(datos);
  const paginas = Math.min(pdf.numPages, MAX_PAGINAS);
  const { text } = await extractText(pdf, { mergePages: true });
  const texto = limpiar(Array.isArray(text) ? text.join('\n\n') : String(text));

  if (texto.replace(/\s/g, '').length < 20) {
    throw new SinTextoError(
      'pdf',
      `El PDF no tiene texto extraíble (${pdf.numPages} página(s)). Casi seguro es un escaneo o son imágenes: haría falta OCR, que Kaizen no tiene.`,
    );
  }

  const r = recortar(texto, 'pdf');
  if (pdf.numPages > MAX_PAGINAS) {
    r.aviso = `${r.aviso ?? ''} Solo se leyeron las primeras ${paginas} de ${pdf.numPages} páginas.`.trim();
  }
  return r;
}

// ── Word ──────────────────────────────────────────────────────────────────

async function deDocx(datos: Buffer): Promise<Extraccion> {
  const { value } = await mammoth.extractRawText({ buffer: datos });
  const texto = limpiar(value);
  if (!texto) throw new SinTextoError('docx', 'El documento de Word no tiene texto (puede ser solo imágenes).');
  return recortar(texto, 'docx');
}

// ── Excel ─────────────────────────────────────────────────────────────────

/** Una celda de exceljs puede ser fórmula, fecha, texto enriquecido o hipervínculo. */
function celdaATexto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'object') {
    const v = valor as Record<string, unknown>;
    // Fórmula: interesa el RESULTADO, no la fórmula — es lo que se busca.
    if ('result' in v) return celdaATexto(v.result);
    if ('text' in v) return String(v.text);
    if ('hyperlink' in v) return String(v.text ?? v.hyperlink);
    if ('richText' in v && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('');
    }
    return '';
  }
  return String(valor);
}

/**
 * Una hoja de cálculo se aplana a texto con el nombre de la hoja y las filas
 * separadas por tabulación. Se conserva el nombre de la hoja a propósito: sin
 * él, un número suelto no se puede ubicar y el modelo no sabe de qué habla.
 */
async function deXlsx(datos: Buffer): Promise<Extraccion> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(datos as unknown as ArrayBuffer);

  const partes: string[] = [];
  const truncadas: string[] = [];

  libro.eachSheet((hoja) => {
    const filas: string[] = [];
    hoja.eachRow({ includeEmpty: false }, (fila, numero) => {
      if (numero > MAX_FILAS) return;
      const celdas: string[] = [];
      fila.eachCell({ includeEmpty: true }, (celda) => celdas.push(celdaATexto(celda.value)));
      const linea = celdas.join('\t').trimEnd();
      if (linea) filas.push(linea);
    });
    if (hoja.rowCount > MAX_FILAS) truncadas.push(`${hoja.name} (${hoja.rowCount} filas)`);
    if (filas.length) partes.push(`## Hoja: ${hoja.name}\n${filas.join('\n')}`);
  });

  const texto = limpiar(partes.join('\n\n'));
  if (!texto) throw new SinTextoError('xlsx', 'El Excel no tiene celdas con contenido.');

  const r = recortar(texto, 'xlsx');
  if (truncadas.length) {
    r.aviso = `${r.aviso ?? ''} Hojas recortadas a ${MAX_FILAS} filas: ${truncadas.join(', ')}.`.trim();
  }
  return r;
}

// ── PowerPoint ────────────────────────────────────────────────────────────

/**
 * Un .pptx es un ZIP de XML. No hay librería chica y confiable para esto, así
 * que se leen los `<a:t>` (los "text run" de OpenXML), que es donde vive todo
 * el texto visible de una diapositiva.
 */
async function dePptx(datos: Buffer): Promise<Extraccion> {
  const zip = await JSZip.loadAsync(datos);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    // slide2 antes que slide10: el orden alfabético los invierte.
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  const partes: string[] = [];
  for (const [i, nombre] of slides.entries()) {
    const xml = await zip.files[nombre].async('string');
    const textos = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) =>
      m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
    );
    const contenido = limpiar(textos.join('\n'));
    if (contenido) partes.push(`## Diapositiva ${i + 1}\n${contenido}`);
  }

  const texto = partes.join('\n\n');
  if (!texto) throw new SinTextoError('pptx', 'La presentación no tiene texto extraíble (puede ser solo imágenes).');
  return recortar(texto, 'pptx');
}

// ── Texto plano y tabulares ───────────────────────────────────────────────

function deTexto(datos: Buffer, via: string): Extraccion {
  const texto = limpiar(datos.toString('utf8'));
  if (!texto) throw new SinTextoError(via, 'El archivo está vacío.');
  return recortar(texto, via);
}

const ENTIDADES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
};

/**
 * HTML a texto. Sin esto un .html se indexaba crudo: el tsvector se llenaba de
 * nombres de clases CSS y de etiquetas, y el fragmento que ve el modelo era
 * marcado en vez de contenido (verificado 2026-08-25 con un reporte de 20 KB
 * del que el 90% era <style>).
 *
 * No se usa un parser: para extraer texto plano alcanza con quitar los bloques
 * que no son contenido y las etiquetas, y una dependencia más no se justifica.
 */
function deHtml(datos: Buffer): Extraccion {
  let s = datos.toString('utf8');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|head|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // Los cierres de bloque son saltos de línea: sin esto el texto de dos celdas
  // o dos párrafos queda pegado en una sola palabra.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|td|th)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  for (const [ent, ch] of Object.entries(ENTIDADES)) s = s.split(ent).join(ch);
  s = s.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
  s = s.replace(/[ \t]{2,}/g, ' ');

  const texto = limpiar(s);
  if (texto.replace(/\s/g, '').length < 20) {
    throw new SinTextoError('html', 'El HTML no tiene texto legible fuera del marcado.');
  }
  return recortar(texto, 'html');
}

// ── Despacho ──────────────────────────────────────────────────────────────

/** Extensiones de texto que se leen tal cual. */
const EXT_TEXTO = /\.(md|markdown|txt|csv|tsv|json|jsonl|ya?ml|xml|html?|log|sql|ini|toml|srt|vtt)$/i;

/**
 * Extrae texto de un archivo binario descargado de Drive.
 *
 * Devuelve `null` SOLO si el tipo no está soportado (video, audio, binarios, y
 * las imágenes en formatos que la visión no acepta o cuando está apagada). Si
 * el tipo está soportado pero no se pudo sacar texto, LANZA SinTextoError con
 * el motivo — para que el indexador lo cuente como fallo visible y no como
 * éxito silencioso.
 */
export async function extraerTexto(datos: Buffer, mimeType: string, nombre: string): Promise<Extraccion | null> {
  const mime = (mimeType || '').toLowerCase();

  // Las imágenes van primero: un .svg es técnicamente texto y lo agarraría la
  // rama de EXT_TEXTO más abajo, devolviendo el XML crudo del vector — que es
  // exactamente el ruido que se limpió del HTML el 2026-08-25.
  if (esImagen(mime, nombre)) {
    return describirImagen(datos, mime, nombre);
  }

  if (mime === 'application/pdf' || /\.pdf$/i.test(nombre)) {
    return dePdf(new Uint8Array(datos));
  }
  if (mime.includes('wordprocessingml') || /\.docx$/i.test(nombre)) {
    return deDocx(datos);
  }
  if (mime.includes('spreadsheetml') || /\.xlsx?m?$/i.test(nombre)) {
    return deXlsx(datos);
  }
  if (mime.includes('presentationml') || /\.pptx$/i.test(nombre)) {
    return dePptx(datos);
  }
  if (mime === 'text/html' || /\.x?html?$/i.test(nombre)) {
    return deHtml(datos);
  }
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || EXT_TEXTO.test(nombre)) {
    return deTexto(datos, mime.startsWith('text/') ? mime.slice(5) : 'texto');
  }

  // .doc y .xls viejos (binarios pre-2007) no los lee ninguna librería chica.
  if (/\.(doc|xls|ppt)$/i.test(nombre)) {
    throw new SinTextoError(
      'formato-viejo',
      `"${nombre}" está en formato binario de Office anterior a 2007. Guárdalo como .docx/.xlsx/.pptx o súbelo a Drive como documento de Google.`,
    );
  }

  return null;
}

/** Para el mensaje de "tipo no soportado": qué SÍ se puede leer. */
export const FORMATOS_SOPORTADOS =
  'Google Docs, Sheets y Slides · PDF con texto · Word (.docx) · Excel (.xlsx) · PowerPoint (.pptx) · ' +
  'imágenes .png/.jpg/.webp/.gif (se describen con visión, no es OCR exacto) · ' +
  'y cualquier archivo de texto (.md, .txt, .csv, .tsv, .json, .yaml, .xml, .html)';
