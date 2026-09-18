import 'dotenv/config';

// Ejercita el cliente de TikTok y el análisis contra mock/tiktokApiMock.ts,
// sin Claude, server ni Postgres (la credencial queda en memoria y avisa).
// Uso:  npm run mock:tiktok   (otra terminal)   →   npm run test:tiktok

const PUERTO = process.env.MOCK_TIKTOK_PORT || '4700';
process.env.TIKTOK_API_BASE_URL = `http://localhost:${PUERTO}`;
process.env.TIKTOK_CLIENT_KEY = 'mock';
process.env.TIKTOK_CLIENT_SECRET = 'mock';
process.env.TIKTOK_REFRESH_TOKEN = process.env.TEST_TIKTOK_REFRESH || 'rt-0';
process.env.DATABASE_URL ??= 'postgresql://mock:mock@localhost:5432/mock';
process.env.JWT_SECRET ??= 'mock-jwt-secret-mock-jwt-secret-mock';
process.env.FINZEN_API_URL ??= 'http://localhost:4500';

let ok = 0, mal = 0;
const afirmar = (c: unknown, q: string) => { if (c) { ok++; console.log(`  ✔ ${q}`); } else { mal++; console.log(`  ✖ ${q}`); } };

async function main() {
  const tt = await import('../clients/tiktokApi');
  const an = await import('../services/tiktokAnalisis');
  console.log(`Probando contra ${process.env.TIKTOK_API_BASE_URL}`);

  console.log('\n── Perfil propio ──');
  const p = await tt.getPerfilPropio(25);
  afirmar(p.usuario === 'finzenai' && p.seguidores === 1830, `usuario ${p.usuario}, ${p.seguidores} seguidores`);
  afirmar(p.videos.length === 25, `25 videos en dos páginas (${p.videos.length})`);
  afirmar(p.videos[5].titulo === '' && p.videos[5].descripcion.length > 0, 'video sin título → cadena vacía, con descripción');
  afirmar(/^2026-09-17T/.test(p.videos[0].timestamp), 'create_time en segundos → ISO');
  const p60 = await tt.getPerfilPropio(99);
  afirmar(p60.videos.length === 57, `99 se topea y la cuenta solo tiene 57 (${p60.videos.length})`);

  console.log('\n── Rotación del refresh token ──');
  // La segunda lectura usó el access token en caché; forzamos vencimiento y
  // verificamos que el refresh vigente sea el ROTADO, no el de la variable.
  tt.olvidarCredencialTiktok();
  const p2 = await tt.getPerfilPropio(1).catch((e: Error) => e);
  afirmar(p2 instanceof Error && /rotated|expiró|no sirve/.test(p2.message), 'olvidar la credencial rotada y volver a rt-0 falla (como en la realidad): el token vigente vive en la BD/memoria');

  console.log('\n── Análisis ──');
  process.env.TIKTOK_REFRESH_TOKEN = 'rt-1';
  const { config } = await import('../config');
  (config.tiktok as { refreshToken: string }).refreshToken = 'rt-1';
  tt.olvidarCredencialTiktok();
  an.vaciarCacheTiktok();
  const a = await an.analizarTiktok({ usuario: 'finzenai', url: 'https://www.tiktok.com/@finzenai', etiqueta: 'FinZen', esPropia: true }, { videos: 20 });
  afirmar(a.resumen_videos.views_mediana < a.resumen_videos.views_promedio / 3, `el viral dispara el promedio (${a.resumen_videos.views_promedio}) muy por encima de la mediana (${a.resumen_videos.views_mediana})`);
  afirmar(a.tasa_engagement_views_pct !== null && a.tasa_engagement_views_pct > 0, `engagement sobre views ${a.tasa_engagement_views_pct} %`);
  afirmar(a.resumen_videos.top[0].views === 148000, 'el top lo encabeza el viral');
  afirmar(a.resumen_videos.videos_por_semana !== null, `ritmo ${a.resumen_videos.videos_por_semana} videos/semana`);
  const b = await an.analizarTiktok({ usuario: 'finzenai', url: '', etiqueta: null, esPropia: true }, { videos: 20 });
  afirmar(b.desde_cache, 'segunda lectura desde caché');
  const c = await an.analizarTiktok({ usuario: 'otro', url: '', etiqueta: null, esPropia: true }).catch((e: Error) => e);
  afirmar(c instanceof Error && /autorizó a Kaizen es @finzenai/.test(c.message), 'cuenta guardada distinta de la autorizada → error claro');
  const d = await an.analizarTiktok({ usuario: 'compe', url: '', etiqueta: null, esPropia: false }).catch((e: Error) => e);
  afirmar(d instanceof Error && /tercero/.test(d.message), 'un tercero no se lee, con motivo');

  console.log(`\n${ok} ✔ · ${mal} ✖`);
  process.exit(mal ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
