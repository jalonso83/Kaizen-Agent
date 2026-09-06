import { db } from '../db';
import { TONO_FALLBACK } from './tonoFallback';

// ─────────────────────────────────────────────────────────────────────────
// Inyección del tono de marca en el system prompt — DISENO_FASE1.md §8/§9.
// Lee del índice local (CerebroDoc, ya poblado por jobs/cerebroIndex.ts), NO
// llama a Drive en vivo. Busca en 00-nucleo el doc cuyo nombre matchee
// /tono|voz|marca/i; si pesa poco se inyecta completo (queda cacheado en el
// prompt, sin gastar una tool call); si es grande, un extracto — el resto
// queda disponible vía search_cerebro.
//
// SI NO HAY NINGUNO, cae al respaldo del repo (`tonoFallback.ts`) en vez de
// devolver nada. Hasta el 2026-09-06 devolvía `undefined` y nadie lo sabía: la
// auditoría de Drive encontró que en 00-nucleo no hay ningún documento de tono
// —los dos manuales viven en Contenidos, que el indexador no recorre— así que
// el bloque de tono llevaba meses vacío mientras la regla dura 10 prohibía
// redactar copy sin él.
//
// El Cerebro SIEMPRE gana: el respaldo solo entra si la búsqueda no encontró
// nada. Por eso subir el manual a 00-nucleo/ no requiere tocar código.
// ─────────────────────────────────────────────────────────────────────────

const TONE_NAME_RE = /tono|voz|marca/i;
const FULL_INJECT_CHAR_LIMIT = 20_000; // ~5K tokens (4 chars/token aprox)
const EXTRACT_CHARS = 4_000;

export interface TonoDeMarca {
  texto: string;
  /** De dónde salió. El prompt lo dice explícitamente: el modelo debe saber si está leyendo la fuente oficial o un respaldo. */
  fuente: 'cerebro' | 'repo';
  /** Nombre del documento del Cerebro, cuando viene de ahí — para poder citarlo. */
  documento?: string;
}

export async function getTonoDeMarca(): Promise<TonoDeMarca> {
  // Un fallo de BD no puede dejar al agente sin tono: caería en el caso "no
  // disponible" de la regla 10 y se negaría a redactar por algo que no tiene
  // nada que ver con la marca.
  let candidates: Array<{ name: string; text: string }>;
  try {
    candidates = await db.cerebroDoc.findMany({
      where: { path: { startsWith: '00-nucleo' } },
      select: { name: true, text: true, indexedAt: true },
      orderBy: { indexedAt: 'desc' },
    });
  } catch (err) {
    console.warn('[tono] No se pudo leer el Cerebro; se usa el respaldo del repo:', err instanceof Error ? err.message : err);
    return { texto: TONO_FALLBACK, fuente: 'repo' };
  }

  const doc = candidates.find((d) => TONE_NAME_RE.test(d.name));
  if (!doc) return { texto: TONO_FALLBACK, fuente: 'repo' };

  if (doc.text.length <= FULL_INJECT_CHAR_LIMIT) {
    return { texto: doc.text, fuente: 'cerebro', documento: doc.name };
  }
  return {
    texto: `${doc.text.slice(0, EXTRACT_CHARS)}…\n\n(Extracto — el documento completo es más largo; usa search_cerebro("tono de voz") para más detalle.)`,
    fuente: 'cerebro',
    documento: doc.name,
  };
}
