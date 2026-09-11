// ─────────────────────────────────────────────────────────────────────────
// Los dos ámbitos de Kaizen (2026-09-10).
//
// Kaizen atiende dos conversaciones distintas que hasta ahora estaban mezcladas
// en un solo catálogo y un solo prompt:
//
//   finzen    — la APP y su tablero: KPIs de la Agent API, segmentos, campañas
//               internas por push, metas, retención, experimentos de producto.
//   marketing — el mundo de AFUERA: redes sociales (Instagram primero),
//               contenido para publicar, pauta en Meta, cuentas de marketing.
//
// Esta es la ÚNICA definición. Los skills declaran su ámbito por la carpeta en
// la que viven (server/skills/<ambito>/<slug>) y las tools por el campo
// `ambito` — el system prompt se arma leyendo los dos registros, así que no
// hay una tercera lista escrita a mano que pueda quedar vieja.
//
// 'comun' existe para lo que sirve en los dos lados (el Cerebro, load_skill).
// No es un tercer ámbito de conversación: es la marca de "no discrimina".
// ─────────────────────────────────────────────────────────────────────────

export type Ambito = 'finzen' | 'marketing';
export type AmbitoTool = Ambito | 'comun';

export const AMBITOS: readonly Ambito[] = ['finzen', 'marketing'] as const;

export function esAmbito(v: string): v is Ambito {
  return (AMBITOS as readonly string[]).includes(v);
}

/** Cómo se le explica cada ámbito al modelo: qué es, y qué señales lo delatan. */
export const DESCRIPCION_AMBITO: Record<Ambito, { titulo: string; que: string; senales: string }> = {
  finzen: {
    titulo: 'FinZen (la app y su tablero)',
    que: 'Lo que pasa DENTRO de la app: registros, activación, DAU/WAU/MAU, retención, MRR, churn, planes, segmentos de usuarios, campañas internas por push/slot con holdout, metas de crecimiento, experimentos de producto.',
    senales:
      'el socio habla de KPIs, del tablero o dashboard, de usuarios, segmentos, retención, MRR, "cómo vamos", del resumen semanal, de una campaña push, de la meta, de un lift.',
  },
  marketing: {
    titulo: 'Marketing (redes, contenido y pauta)',
    que: 'Lo que pasa FUERA de la app: las cuentas de redes sociales de FinZen (Instagram primero; TikTok después), ideas y piezas de contenido para publicar, resultados de piezas publicadas, la pauta en Meta Ads y su costo, los perfiles guardados en el apartado de Marketing.',
    senales:
      'el socio habla de Instagram, TikTok, reels, carruseles, guiones, stories, seguidores, views, likes, del perfil de una cuenta, de un competidor, de ideas de contenido, de anuncios o Meta Ads, de la pauta o el presupuesto de adquisición.',
  },
};
