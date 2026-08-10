import Anthropic from '@anthropic-ai/sdk';
import { config } from './config';
import { listSegments, FinzenApiError } from './clients/finzenApi';
import { drive, driveAuthMode } from './clients/drive';

// ─────────────────────────────────────────────────────────────────────────
// Smoke tests de conexiones: `npm run check`
// Verifica que Kaizen puede hablar con sus 3 mundos (FinZen, Anthropic,
// Drive) ANTES de escribir features. Correr después de configurar .env y
// después de cada deploy.
// ─────────────────────────────────────────────────────────────────────────

type Result = { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail: string };

async function checkFinzen(): Promise<Result> {
  const name = 'FinZen Agent API';
  try {
    const segments = await listSegments();
    return { name, status: 'PASS', detail: `${segments.length} segmentos en el catálogo: ${segments.map((s) => s.slug).join(', ')}` };
  } catch (e) {
    if (e instanceof FinzenApiError) {
      if (e.status === 503) return { name, status: 'FAIL', detail: 'Conexión OK pero la Agent API está APAGADA (FinZen debe configurar AGENT_API_KEY en Railway)' };
      if (e.status === 401) return { name, status: 'FAIL', detail: 'La API rechazó la key — revisa FINZEN_AGENT_KEY en tu .env' };
      return { name, status: 'FAIL', detail: `HTTP ${e.status}: ${e.message}` };
    }
    return { name, status: 'FAIL', detail: `No se pudo conectar: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function checkAnthropic(): Promise<Result> {
  const name = 'Anthropic (Claude)';
  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const res = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Responde solo: ok' }],
    });
    const text = res.content.find((b) => b.type === 'text');
    return { name, status: 'PASS', detail: `Modelo ${res.model} respondió: "${text && 'text' in text ? text.text.trim() : '(sin texto)'}"` };
  } catch (e) {
    return { name, status: 'FAIL', detail: e instanceof Error ? e.message : String(e) };
  }
}

async function checkDrive(): Promise<Result> {
  const name = `Google Drive · LECTURA (${driveAuthMode()})`;
  if (!drive.isConfigured()) {
    return { name, status: 'SKIP', detail: 'Sin configurar (GOOGLE_OAUTH_* o GOOGLE_SERVICE_ACCOUNT_* / DRIVE_CEREBRO_FOLDER_ID)' };
  }
  try {
    const files = await drive.listCerebroFiles();
    return { name, status: 'PASS', detail: `${files.length} archivos en la carpeta Cerebro` };
  } catch (e) {
    return { name, status: 'FAIL', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Escritura REAL en 50-kaizen/: crea un archivo de prueba y lo borra.
 *
 * Antes este smoke test solo listaba el Cerebro, y por eso pasó siete meses en
 * verde mientras la escritura estaba rota de raíz: con una service account,
 * crear archivos en un Drive personal es IMPOSIBLE (no tienen cuota). Listar
 * funcionaba, así que nada avisaba. Comprobar lo que de verdad se usa —escribir—
 * es lo único que cierra ese hueco.
 */
async function checkDriveEscritura(): Promise<Result> {
  const name = 'Google Drive · ESCRITURA (50-kaizen/)';
  if (!drive.isConfigured()) {
    return { name, status: 'SKIP', detail: 'Drive sin configurar' };
  }
  try {
    const res = await drive.saveCerebroNote(
      'prueba-permisos-check',
      'Archivo de prueba de `npm run check`. Si lo ves, bórralo.',
    );
    await drive.deleteFile(res.id);
    return { name, status: 'PASS', detail: 'creó y borró un archivo de prueba' };
  } catch (e) {
    return { name, status: 'FAIL', detail: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  console.log('Kaizen · smoke tests de conexiones\n');
  const results = await Promise.all([checkFinzen(), checkAnthropic(), checkDrive(), checkDriveEscritura()]);

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️ ' : '❌';
    console.log(`${icon} ${r.status.padEnd(4)} ${r.name}: ${r.detail}`);
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(failed.length === 0 ? '\nTodo listo.' : `\n${failed.length} conexión(es) con problemas — resolver antes de continuar.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
