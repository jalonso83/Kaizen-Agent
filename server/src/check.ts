import Anthropic from '@anthropic-ai/sdk';
import { config } from './config';
import { listSegments, FinzenApiError } from './clients/finzenApi';
import { drive } from './clients/drive';

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
  const name = 'Google Drive (Cerebro)';
  if (!drive.isConfigured()) {
    return { name, status: 'SKIP', detail: 'Sin configurar (GOOGLE_SERVICE_ACCOUNT_PATH / DRIVE_CEREBRO_FOLDER_ID) — pendiente para Fase 1' };
  }
  try {
    const files = await drive.listCerebroFiles();
    return { name, status: 'PASS', detail: `${files.length} archivos en la carpeta Cerebro` };
  } catch (e) {
    return { name, status: 'FAIL', detail: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  console.log('Kaizen · smoke tests de conexiones\n');
  const results = await Promise.all([checkFinzen(), checkAnthropic(), checkDrive()]);

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️ ' : '❌';
    console.log(`${icon} ${r.status.padEnd(4)} ${r.name}: ${r.detail}`);
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(failed.length === 0 ? '\nTodo listo.' : `\n${failed.length} conexión(es) con problemas — resolver antes de continuar.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
