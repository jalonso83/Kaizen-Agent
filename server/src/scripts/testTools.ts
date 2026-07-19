import 'dotenv/config';
import { getKpisTool, getCampaignResultsTool } from '../agent/tools/kpis';
import { listSegmentsTool, evaluateSegmentTool } from '../agent/tools/segments';
import { loadSkillTool } from '../agent/tools/skill';
import type { ToolContext } from '../agent/tools/guard';

// ─────────────────────────────────────────────────────────────────────────
// Ejercita las 5 tools de lectura DIRECTO, sin pasar por Claude ni por el
// server HTTP. Sirve para probar el mock de la FinZen Agent API (o la real)
// de punta a punta sin necesitar ANTHROPIC_API_KEY que funcione de verdad.
//
// La BD es opcional acá: withGuard igual intenta escribir el audit log, pero
// audit.log() traga el error si Postgres no está disponible y sigue — así
// que esto corre incluso sin DATABASE_URL apuntando a algo real. `config.ts`
// sí exige que la variable EXISTA (aunque sea un placeholder) porque valida
// al importar, no que sea alcanzable — ver server/.env.example.
//
// Uso:
//   npm run mock:finzen                    # en otra terminal
//   npm run test:tools
//   npm run test:tools -- --segment=dormant --skill=copy-push
// ─────────────────────────────────────────────────────────────────────────

function argValue(flag: string, fallback: string): string {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const ctx: ToolContext = { conversationId: null };

async function run(name: string, fn: () => Promise<string>) {
  console.log(`\n── ${name} ──`);
  try {
    const result = await fn();
    console.log(result);
  } catch (err) {
    console.error('ERROR:', err instanceof Error ? err.message : err);
  }
}

async function main() {
  console.log(`Probando contra FINZEN_API_URL=${process.env.FINZEN_API_URL}`);

  await run('get_kpis', () => getKpisTool.execute({}, ctx));
  await run('get_campaign_results', () => getCampaignResultsTool.execute({}, ctx));
  await run('list_segments', () => listSegmentsTool.execute({}, ctx));

  const segmentSlug = argValue('segment', 'budget_exceeded');
  await run(`evaluate_segment(${segmentSlug})`, () => evaluateSegmentTool.execute({ slug: segmentSlug }, ctx));

  await run('evaluate_segment(slug inexistente)', () =>
    evaluateSegmentTool.execute({ slug: 'no_existe_este_segmento' }, ctx),
  );

  const skillSlug = argValue('skill', 'copy-push');
  await run(`load_skill(${skillSlug})`, async () => {
    const body = await loadSkillTool.execute({ slug: skillSlug }, ctx);
    return `${body.slice(0, 200)}…  [${body.length} chars total]`;
  });

  console.log('\nListo — si todo lo de arriba trajo datos (o el error esperado de slug inexistente), el mock/API responde bien.');
}

main().catch((err) => {
  console.error('Error inesperado:', err instanceof Error ? err.message : err);
  process.exit(1);
});
