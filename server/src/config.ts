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
