import dotenv from 'dotenv';

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────
// Configuración de Kaizen. Todas las env vars pasan por aquí — nada de
// process.env suelto por el código. Las REQUERIDAS tumban el boot si faltan
// (mejor fallar en el arranque que a mitad de una conversación); las de
// Fase 1 son opcionales por ahora y se validan cuando la feature se usa.
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

  // FinZen Agent API (contrato: PRD §4)
  finzen: {
    apiUrl: required('FINZEN_API_URL').replace(/\/+$/, ''),
    agentKey: required('FINZEN_AGENT_KEY'),
  },

  // Anthropic / Claude
  anthropicApiKey: required('ANTHROPIC_API_KEY'),

  // Google Drive (Fase 1 — opcionales hasta que FinZen comparta las carpetas)
  drive: {
    serviceAccountPath: optional('GOOGLE_SERVICE_ACCOUNT_PATH'),
    cerebroFolderId: optional('DRIVE_CEREBRO_FOLDER_ID'),
    contenidosFolderId: optional('DRIVE_CONTENIDOS_FOLDER_ID'),
  },

  // BD propia de Kaizen (Fase 1)
  databaseUrl: optional('DATABASE_URL'),

  // Auth del chat de socios (Fase 1)
  jwtSecret: optional('JWT_SECRET'),

  // Kill switch propio: en false, el loop del agente no corre.
  agentEnabled: process.env.AGENT_ENABLED !== 'false',
};
