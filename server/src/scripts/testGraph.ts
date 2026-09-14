import 'dotenv/config';

// ─────────────────────────────────────────────────────────────────────────
// Ejercita los clientes de Meta e Instagram y el análisis del perfil contra
// el simulador local (mock/graphApiMock.ts), sin Claude, sin server HTTP y
// sin Postgres. Cada caso AFIRMA algo: no es un "imprime y mirá".
//
// Lo que se verifica es lo que las pruebas unitarias no pueden: que la
// sintaxis del campo anidado de business_discovery llegue bien por la red,
// que los strings de Graph se conviertan, que un 200 sin el campo se
// detecte, que un permiso faltante en insights deje el perfil intacto, y que
// una métrica retirada rompa solo su grupo.
//
// Uso:
//   npm run mock:graph            # en otra terminal
//   npm run test:graph
//   MOCK_GRAPH_METRICAS_RETIRADAS=views npm run mock:graph   # y de nuevo test:graph
//
// Las variables de Meta se fuerzan acá al simulador para que este script no
// pueda pegarle a la Graph real por accidente, aunque el .env tenga el token.
// ─────────────────────────────────────────────────────────────────────────

const PUERTO = process.env.MOCK_GRAPH_PORT || '4600';
process.env.META_API_BASE_URL = `http://localhost:${PUERTO}`;
process.env.META_SYSTEM_TOKEN = process.env.TEST_GRAPH_TOKEN || 'mock-meta-token';
process.env.META_AD_ACCOUNT_ID = 'act_123';
process.env.INSTAGRAM_ACCOUNT_ID = '17841400000000001';
process.env.META_WRITE_ENABLED ??= 'false';
// config.ts exige que existan (no que apunten a algo real).
process.env.DATABASE_URL ??= 'postgresql://mock:mock@localhost:5432/mock';
process.env.JWT_SECRET ??= 'mock-jwt-secret-mock-jwt-secret-mock';
process.env.FINZEN_API_URL ??= 'http://localhost:4500';

let ok = 0;
let mal = 0;

function afirmar(cond: unknown, que: string): void {
  if (cond) {
    ok++;
    console.log(`  ✔ ${que}`);
  } else {
    mal++;
    console.log(`  ✖ ${que}`);
  }
}

async function caso(nombre: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n── ${nombre} ──`);
  try {
    await fn();
  } catch (e) {
    mal++;
    console.log(`  ✖ lanzó: ${e instanceof Error ? e.message : e}`);
  }
}

async function esperaError(fn: () => Promise<unknown>, patron: RegExp, que: string): Promise<void> {
  try {
    await fn();
    afirmar(false, `${que} (no lanzó)`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    afirmar(patron.test(m), `${que} — "${m.slice(0, 110)}${m.length > 110 ? '…' : ''}"`);
  }
}

async function main(): Promise<void> {
  // Imports dinámicos: config.ts lee process.env al cargarse, y arriba recién
  // se fijaron las variables.
  const meta = await import('../clients/metaApi');
  const ig = await import('../clients/instagramApi');
  const analisis = await import('../services/instagramAnalisis');

  console.log(`Probando contra ${process.env.META_API_BASE_URL} con token "${process.env.META_SYSTEM_TOKEN}"`);

  // ── Meta ────────────────────────────────────────────────────────────────
  await caso('Meta: cuenta, campañas y gasto', async () => {
    const acc = await meta.getAccount();
    afirmar(acc.currency === 'USD' && acc.account_status === 1, 'la cuenta trae moneda y estado');
    const camps = await meta.getCampaigns();
    afirmar(camps.length === 3, `3 campañas (${camps.length})`);
    const pausada = camps.find((c) => c.name.includes('Retargeting'));
    afirmar(pausada?.status === 'ACTIVE' && pausada?.effective_status === 'CAMPAIGN_PAUSED', 'status ≠ effective_status se conserva');
    afirmar(typeof camps[0].daily_budget === 'number' && camps[0].daily_budget === 1500, `daily_budget "1500" (string) → 1500 en unidades menores (${camps[0].daily_budget})`);
    const gasto = await meta.getSpend('2026-09-01', '2026-09-07');
    afirmar(gasto.length === 2 && gasto[0].spend === 87.43, `spend "87.43" → número (${gasto[0]?.spend})`);
    afirmar(Number.isFinite(gasto[0].ctr), 'ctr con 6 decimales sigue siendo número');
  });

  await caso('Meta: escritura deshabilitada', async () => {
    await esperaError(
      () => meta.createCampaignDraft({ name: 'x', objective: 'OUTCOME_LEADS', dailyBudgetUsd: 10 }),
      /META_WRITE_ENABLED|escritura|deshabilitad/i,
      'createCampaignDraft rechaza con META_WRITE_ENABLED=false',
    );
  });

  // ── Instagram: perfiles ─────────────────────────────────────────────────
  await caso('Instagram: la cuenta propia', async () => {
    const p = await ig.getPerfil('finzenai', 25);
    afirmar(p.usuario === 'finzenai' && p.seguidores === 4820, `seguidores ${p.seguidores}`);
    afirmar(p.publicaciones.length === 25, `25 publicaciones (${p.publicaciones.length})`);
    const sinComentarios = p.publicaciones[4];
    afirmar(sinComentarios.comments_count === 0, 'pieza sin comments_count → 0, no NaN');
    const sinCaption = p.publicaciones[3];
    afirmar(sinCaption.caption === '', 'pieza sin caption → cadena vacía');
    const viejas = p.publicaciones.slice(-3);
    afirmar(viejas.every((x) => x.media_product_type === null), 'las 3 más viejas sin media_product_type → null');
    afirmar(p.publicaciones[0].media_product_type === 'REELS', 'las nuevas traen REELS/FEED');
    afirmar(p.sitio_web === 'https://finzenai.com', 'sitio web');
  });

  await caso('Instagram: límite de publicaciones y tope', async () => {
    const p5 = await ig.getPerfil('finzenai', 5);
    afirmar(p5.publicaciones.length === 5, `limit(5) llega a Graph (${p5.publicaciones.length})`);
    const p99 = await ig.getPerfil('competidor', 99);
    afirmar(p99.publicaciones.length === 50, `99 se topea a 50 (${p99.publicaciones.length})`);
  });

  await caso('Instagram: los tres fallos de perfil', async () => {
    await esperaError(() => ig.getPerfil('noexiste'), /no encontró|mal escrito|privada/i, 'usuario inexistente → traducido');
    await esperaError(() => ig.getPerfil('personal'), /Business ni Creator|no es una cuenta/i, 'cuenta personal → traducido');
    await esperaError(() => ig.getPerfil('sinperfil'), /sin datos|privada|personal/i, '200 sin business_discovery → error, no perfil en cero');
  });

  await caso('Instagram: cuenta sin piezas', async () => {
    const p = await ig.getPerfil('sinpiezas');
    afirmar(p.publicaciones.length === 0 && p.publicaciones_totales === 0, 'perfil válido con cero piezas');
    const r = analisis.resumirPublicaciones(p.publicaciones);
    afirmar(r.likes_promedio === 0 && r.piezas_por_semana === null, 'resumen en cero, sin NaN');
  });

  // ── Instagram: insights ─────────────────────────────────────────────────
  await caso('Instagram: insights de la cuenta propia', async () => {
    const i = await ig.getInsightsPropios(28);
    const retiradas = i.no_disponible.flatMap((n) => n.metricas);
    if (retiradas.length) console.log(`  (grupos no disponibles en este simulador: ${retiradas.join(', ')})`);
    afirmar(i.ventana.dias === 28, 'ventana de 28 días');
    if (!retiradas.includes('reach')) {
      afirmar(i.totales.reach === 18420, `reach "18420" (string) → ${i.totales.reach}`);
      afirmar(i.totales.saves === 310, `saves → ${i.totales.saves}`);
    }
    if (!retiradas.includes('follower_count')) {
      afirmar(i.seguidores_por_dia.length >= 27 && i.seguidores_por_dia.length <= 30, `serie diaria de ${i.seguidores_por_dia.length} puntos`);
      afirmar(/^\d{4}-\d{2}-\d{2}$/.test(i.seguidores_por_dia[0].fecha), 'end_time → YYYY-MM-DD');
    }
    // Lo que importa: si un grupo cayó, los otros llegaron igual.
    const grupos = 4;
    afirmar(Object.keys(i.totales).length + i.no_disponible.length >= 1 && i.no_disponible.length < grupos, 'una métrica retirada no tumba los demás grupos');
  });

  // ── Análisis completo (sin BD: el histórico se omite con aviso) ─────────
  await caso('Análisis: el mismo que ve el Dashboard', async () => {
    analisis.vaciarCacheInstagram();
    const a = await analisis.analizarPerfil({ usuario: 'finzenai', url: 'https://www.instagram.com/finzenai', etiqueta: 'FinZen', esPropia: true });
    afirmar(a.tasa_engagement_pct !== null && a.tasa_engagement_pct > 0, `tasa de engagement ${a.tasa_engagement_pct} %`);
    const r = a.resumen_publicaciones;
    afirmar(r.likes_promedio > r.likes_mediana * 1.2, `la viral sube el promedio (${r.likes_promedio}) por encima de la mediana (${r.likes_mediana})`);
    afirmar(r.por_tipo.some((t) => t.tipo === 'REELS') && r.por_tipo.some((t) => t.tipo === 'FEED'), 'mezcla REELS/FEED');
    afirmar(r.por_tipo.some((t) => t.tipo === 'VIDEO' || t.tipo === 'CAROUSEL_ALBUM'), 'las piezas viejas caen en el tipo grueso');
    afirmar(r.piezas_por_semana !== null && r.piezas_por_semana > 3, `ritmo ${r.piezas_por_semana} piezas/semana`);
    afirmar(a.insights !== null, 'la cuenta propia lleva insights');
    afirmar(Array.isArray(a.historico.puntos), 'el histórico existe aunque no haya BD (vacío, con aviso en consola)');
    const b = await analisis.analizarPerfil({ usuario: 'finzenai', url: '', etiqueta: null, esPropia: true });
    afirmar(b.desde_cache === true, 'la segunda lectura sale de caché');
    const c = await analisis.analizarPerfil({ usuario: 'competidor', url: '', etiqueta: null, esPropia: false });
    afirmar(c.insights === null, 'un tercero no lleva insights');
  });

  // ── Token sin instagram_manage_insights ─────────────────────────────────
  await caso('Token sin permiso de insights: el perfil sigue, los insights lo dicen', async () => {
    process.env.META_SYSTEM_TOKEN = 'mock-sin-insights';
    // config es un objeto ya construido: se toca el campo directo para este caso.
    const { config } = await import('../config');
    const anterior = config.meta.systemToken;
    (config.meta as { systemToken: string }).systemToken = 'mock-sin-insights';
    try {
      const p = await ig.getPerfil('finzenai', 3);
      afirmar(p.seguidores === 4820, 'el perfil se lee igual');
      const i = await ig.getInsightsPropios();
      afirmar(i.no_disponible.length === 4 && Object.keys(i.totales).length === 0, `los 4 grupos reportan el motivo (${i.no_disponible.length})`);
      afirmar(/instagram_manage_insights/.test(i.no_disponible[0].motivo), 'el motivo nombra el permiso que falta');
    } finally {
      (config.meta as { systemToken: string }).systemToken = anterior;
    }
  });

  await caso('Token vencido', async () => {
    const { config } = await import('../config');
    const anterior = config.meta.systemToken;
    (config.meta as { systemToken: string }).systemToken = 'vencido';
    try {
      await esperaError(() => ig.getPerfil('finzenai'), /token|venci|expir/i, 'código 190 → mensaje de token');
    } finally {
      (config.meta as { systemToken: string }).systemToken = anterior;
    }
  });

  console.log(`\n${ok} ✔ · ${mal} ✖`);
  process.exit(mal ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
