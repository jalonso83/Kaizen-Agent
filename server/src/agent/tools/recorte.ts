import type { Historico } from '../../services/instagramAnalisis';

// ─────────────────────────────────────────────────────────────────────────
// Lo que las tools de redes le devuelven AL MODELO, más liviano (2026-10-10).
//
// get_instagram_profile devolvía el análisis entero: ~11-18k tokens por
// llamada, la mayoría en dos partes que el modelo casi no usa:
//   - el texto completo de cada publicación (un caption real ronda los 600
//     caracteres, y van 25-50);
//   - la serie diaria de 90 días, cuando los deltas a 7 y 30 ya vienen
//     calculados en código.
// Con este recorte baja a menos de la mitad. El Dashboard no pasa por acá:
// usa los servicios directo y sigue viendo todo.
// ─────────────────────────────────────────────────────────────────────────

export const MAX_TEXTO_PIEZA = 200;
export const PUNTOS_PARA_MODELO = 30;

export function recortarTexto(t: string, max = MAX_TEXTO_PIEZA): string {
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Los últimos N puntos de la serie; los deltas y la primera lectura quedan intactos. */
export function recortarHistorico(h: Historico, n = PUNTOS_PARA_MODELO): Historico {
  return h.puntos.length > n ? { ...h, puntos: h.puntos.slice(-n) } : h;
}
