import { db } from '../db';

// ─────────────────────────────────────────────────────────────────────────
// Cuánto acierta el prompt caching (2026-10-10).
//
// La única prueba de que el caché funciona son los campos de usage de cada
// respuesta: un prefijo que cambia sin querer (una fecha que se coló en el
// system prompt, una lista de tools en otro orden) no da ningún error, solo
// una cuenta más cara. Por eso esto se muestra en Auditoría en vez de
// mirarlo una vez y olvidarlo.
//
// Solo cuentan los mensajes que traen los campos de caché (los guardados
// después de esta migración): mezclar los viejos, que no los tienen, haría
// parecer que el caché acierta menos de lo que acierta.
// ─────────────────────────────────────────────────────────────────────────

export interface FilaUso {
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export interface ResumenCache {
  /** Respuestas medidas. */
  respuestas: number;
  /** Tokens de entrada leídos del caché (se pagan 0,1×). */
  leidos: number;
  /** Escritos en el caché (1,25×). */
  escritos: number;
  /** Fuera del caché, a precio completo. */
  sinCache: number;
  /** leidos / entrada total × 100, sin decimales. Null sin datos. */
  pctLeido: number | null;
  /**
   * Cuánto costó la entrada comparado con no tener caché, en %: (0,1×leídos +
   * 1,25×escritos + sinCache) / total. 30 significa que se pagó el 30 % de lo
   * que se habría pagado sin caché. Null sin datos.
   */
  pctCosto: number | null;
}

export function resumirCache(filas: FilaUso[]): ResumenCache {
  const medidas = filas.filter((f) => f.cacheReadTokens != null || f.cacheWriteTokens != null);
  const leidos = medidas.reduce((a, f) => a + (f.cacheReadTokens ?? 0), 0);
  const escritos = medidas.reduce((a, f) => a + (f.cacheWriteTokens ?? 0), 0);
  const sinCache = medidas.reduce((a, f) => a + (f.inputTokens ?? 0), 0);
  const total = leidos + escritos + sinCache;
  return {
    respuestas: medidas.length,
    leidos,
    escritos,
    sinCache,
    pctLeido: total > 0 ? Math.round((leidos / total) * 100) : null,
    pctCosto: total > 0 ? Math.round(((0.1 * leidos + 1.25 * escritos + sinCache) / total) * 100) : null,
  };
}

export async function usoCacheDesde(desde: Date): Promise<ResumenCache> {
  const filas = await db.message.findMany({
    where: { role: 'assistant', createdAt: { gte: desde }, OR: [{ cacheReadTokens: { not: null } }, { cacheWriteTokens: { not: null } }] },
    select: { inputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
  });
  return resumirCache(filas);
}
