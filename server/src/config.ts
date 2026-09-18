import dotenv from 'dotenv';

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────
// Configuración de Kaizen. Todas las env vars pasan por aquí — nada de
// process.env suelto por el código. Las REQUERIDAS tumban el boot si faltan
// (mejor fallar en el arranque que a mitad de una conversación); las de
// Fase 1 son opcionales por ahora y se validan cuando la feature se usa.
//
// MODO DEV SIN KEYS (a pedido, 2026-07-19): `FINZEN_AGENT_KEY` y
// `ANTHROPIC_API_KEY` son OPCIONALES a propósito, para poder levantar el
// server y ver la web (login, layout del chat) sin tener esas credenciales
// todavía. Sin ellas: el login/las conversaciones funcionan igual (no las
// usan), pero mandar un mensaje de chat da un error claro en vez de una
// respuesta real (ver runner.ts), y las tools de FinZen van a fallar con 401
// si de verdad se llaman. Antes de deployar a producción, las dos tienen que
// estar puestas — Railway ya las tiene reales (ver docs/ESTADO.md).
// ─────────────────────────────────────────────────────────────────────────

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    console.error(`[Config] Falta la variable de entorno requerida: ${name}. Revisa server/.env (ver .env.example).`);
    process.exit(1);
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export const config = {
  port: Number(process.env.PORT) || 4000,

  // FinZen Agent API (contrato: PRD §4). agentKey opcional (ver nota de
  // arriba) — si falta, las llamadas a FinZen van a dar 401 al usarse, pero
  // el server arranca igual.
  finzen: {
    apiUrl: required('FINZEN_API_URL').replace(/\/+$/, ''),
    agentKey: optional('FINZEN_AGENT_KEY') ?? '',
  },

  // Anthropic / Claude — opcional (ver nota de arriba). Sin ella, runner.ts
  // detecta la ausencia ANTES de construir el cliente del SDK y responde con
  // un error claro en vez de intentar conversar.
  anthropicApiKey: optional('ANTHROPIC_API_KEY'),

  // Indexado del Cerebro.
  cerebro: {
    // Lectura de imágenes (2026-09-03): las imágenes se describen con visión y
    // se indexa esa descripción. Encendido por defecto — es la única forma de
    // que un storyboard o un pantallazo de panel entren al Cerebro. Se apaga
    // con CEREBRO_VISION_ENABLED=false si el gasto molesta: el costo es de una
    // llamada por imagen y por versión (el indexador solo re-lee lo que cambió
    // de modifiedTime), no por corrida ni por búsqueda.
    visionEnabled: process.env.CEREBRO_VISION_ENABLED !== 'false',
    // El mismo modelo del agente, para no tener dos decisiones de modelo en el
    // proyecto. Se puede bajar a claude-haiku-4-5 con CEREBRO_VISION_MODEL si
    // hubiera muchas imágenes y la descripción no necesitara tanto detalle.
    visionModel: optional('CEREBRO_VISION_MODEL') ?? 'claude-opus-4-8',
  },

  // Google Drive (Fase 1 — opcionales hasta que FinZen comparta las carpetas)
  // Credenciales de la service account: por path a JSON (local) o por el JSON
  // en base64 (Railway, donde no hay filesystem para credenciales).
  drive: {
    // ── OAuth de usuario (vía preferida para ESCRIBIR) ─────────────────────
    //
    // Una service account NO PUEDE CREAR archivos en un "Mi unidad" personal:
    // los archivos ahí consumen la cuota de su dueño y una service account no
    // tiene cuota propia. Google responde literalmente "Service Accounts do not
    // have storage quota" por más permisos de Editor que se le den. Leer sí
    // puede; crear no. Verificado contra Drive el 2026-08-09.
    //
    // Las salidas oficiales son unidades compartidas o delegación de dominio, y
    // ambas exigen Google Workspace — finzenai.com está en GoDaddy, así que no
    // aplican. La vía que sí funciona con una cuenta Gmail normal es esta:
    // Kaizen se autentica COMO EL USUARIO con un refresh token, y entonces
    // escribe con la cuota de esa persona.
    //
    // Para obtener el refresh token: `npm run drive:auth` (scripts/driveAuth.ts).
    oauthClientId: optional('GOOGLE_OAUTH_CLIENT_ID'),
    oauthClientSecret: optional('GOOGLE_OAUTH_CLIENT_SECRET'),
    oauthRefreshToken: optional('GOOGLE_OAUTH_REFRESH_TOKEN'),

    // ── Service account (respaldo, SOLO LECTURA) ───────────────────────────
    // Se mantiene porque leer el Cerebro le funciona perfectamente. Si el OAuth
    // de arriba está configurado, tiene prioridad y esto no se usa.
    serviceAccountPath: optional('GOOGLE_SERVICE_ACCOUNT_PATH'),
    serviceAccountJsonBase64: optional('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64'),
    cerebroFolderId: optional('DRIVE_CEREBRO_FOLDER_ID'),
    contenidosFolderId: optional('DRIVE_CONTENIDOS_FOLDER_ID'),
    // 50-kaizen/ dentro del Cerebro: la ÚNICA carpeta donde Kaizen tiene
    // permiso de ESCRITURA sobre el Cerebro (el resto es solo lectura vía
    // cerebroFolderId) — resumen semanal, propuestas y discrepancias. Ya
    // existe en Drive (creada 2026-07-11); falta el ID y que alguien con
    // acceso le dé permiso de Editor a la service account sobre ESA
    // subcarpeta puntual, no sobre el Cerebro entero. Sin esta var, la tool
    // save_cerebro_note falla con un mensaje claro — nunca cae al Cerebro
    // raíz (eso violaría la regla "lectura: todo, escritura: solo 50-kaizen").
    kaizenFolderId: optional('DRIVE_KAIZEN_FOLDER_ID'),
    // Destino del CSV semanal de adquisición. Provisional (2026-07-28): sin
    // esta var cae en la raíz del Cerebro, que es la carpeta que la service
    // account ya tiene compartida. Cuando exista la carpeta definitiva basta
    // con setear la env var — no hay que tocar código ni redeployar el job.
    acquisitionExportFolderId: optional('DRIVE_ACQUISITION_EXPORT_FOLDER_ID'),
  },

  // ── Instagram (Graph API) ───────────────────────────────────────────────
  // Usa el MISMO token que la publicidad (META_SYSTEM_TOKEN), con dos permisos
  // más: instagram_basic y pages_read_engagement. No hay una credencial
  // aparte — es la misma Graph API.
  instagram: {
    // El id del nodo de Instagram de FinZen. Hace falta incluso para leer un
    // perfil ajeno: business_discovery se consulta SOBRE la cuenta propia y
    // pide el perfil de otro como campo (ver clients/instagramApi.ts).
    // Se obtiene desde la página de Facebook vinculada:
    //   GET /{page-id}?fields=instagram_business_account
    accountId: optional('INSTAGRAM_ACCOUNT_ID'),
  },

  // ── Meta Marketing API (Fase 2) ─────────────────────────────────────────
  // Todo opcional: sin credenciales el server arranca igual y las tools de
  // Meta fallan con un mensaje claro, igual que pasa con las de FinZen.
  //
  // writeEnabled arranca en FALSE a propósito y hay que activarlo a mano. El
  // PRD §2.1 manda ads_read primero y ads_management recién tras ≥1 semana de
  // lecturas estables; esto convierte esa secuencia en algo que el código
  // hace cumplir, no en una nota que alguien tiene que recordar.
  meta: {
    baseUrl: (optional('META_API_BASE_URL') ?? 'https://graph.facebook.com/v21.0').replace(/\/+$/, ''),
    systemToken: optional('META_SYSTEM_TOKEN') ?? '',
    adAccountId: optional('META_AD_ACCOUNT_ID') ?? '',
    // Tope de gasto diario por campaña. El default es deliberadamente bajo:
    // si alguien despliega sin definirlo, el error tiene que ser "no me deja
    // gastar", nunca "gastó de más".
    maxDailyBudgetUsd: Number(process.env.META_MAX_DAILY_BUDGET_USD) || 20,
    writeEnabled: process.env.META_WRITE_ENABLED === 'true',
  },

  // ── TikTok Display API (2026-09-18) ─────────────────────────────────────
  // Solo la cuenta PROPIA: la Display API no tiene un business_discovery.
  // El access token dura 24h y se renueva solo con el refresh token (365
  // días), que TikTok puede ROTAR en cada renovación — por eso el vigente
  // vive en la BD (TiktokCredential) y la variable solo siembra el primero.
  tiktok: {
    baseUrl: (optional('TIKTOK_API_BASE_URL') ?? 'https://open.tiktokapis.com/v2').replace(/\/+$/, ''),
    clientKey: optional('TIKTOK_CLIENT_KEY') ?? '',
    clientSecret: optional('TIKTOK_CLIENT_SECRET') ?? '',
    refreshToken: optional('TIKTOK_REFRESH_TOKEN') ?? '',
  },

  // BD propia de Kaizen — ya se usa (audit log, historial, auth): requerida.
  databaseUrl: required('DATABASE_URL'),

  // Auth del chat de socios — ya se usa (JWT en cookie httpOnly): requerida.
  jwtSecret: required('JWT_SECRET'),

  // Guardarraíl de campañas (slice del gate, aún no construido): límite de
  // borradores/día. Opcional con default — DISENO_FASE1.md §1.
  kaizenMaxDraftsPerDay: Number(process.env.KAIZEN_MAX_DRAFTS_PER_DAY) || 5,

  // Kill switch propio: en false, el loop del agente no corre.
  agentEnabled: process.env.AGENT_ENABLED !== 'false',
};
