import { db } from '../db';

// ─────────────────────────────────────────────────────────────────────────
// Inyección del tono de marca en el system prompt — DISENO_FASE1.md §8/§9.
// Lee del índice local (CerebroDoc, ya poblado por jobs/cerebroIndex.ts), NO
// llama a Drive en vivo. Busca en 00-nucleo el doc cuyo nombre matchee
// /tono|voz|marca/i; si pesa poco se inyecta completo (queda cacheado en el
// prompt, sin gastar una tool call); si es grande, un extracto — el resto
// queda disponible vía search_cerebro.
// ─────────────────────────────────────────────────────────────────────────

const TONE_NAME_RE = /tono|voz|marca/i;
const FULL_INJECT_CHAR_LIMIT = 20_000; // ~5K tokens (4 chars/token aprox)
const EXTRACT_CHARS = 4_000;

export async function getTonoDeMarca(): Promise<string | undefined> {
  const candidates = await db.cerebroDoc.findMany({
    where: { path: { startsWith: '00-nucleo' } },
    select: { name: true, text: true, indexedAt: true },
    orderBy: { indexedAt: 'desc' },
  });

  const doc = candidates.find((d) => TONE_NAME_RE.test(d.name));
  if (!doc) return undefined;

  if (doc.text.length <= FULL_INJECT_CHAR_LIMIT) {
    return doc.text;
  }
  return `${doc.text.slice(0, EXTRACT_CHARS)}…\n\n(Extracto — el documento completo es más largo; usa search_cerebro("tono de voz") para más detalle.)`;
}
