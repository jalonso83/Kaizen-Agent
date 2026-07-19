import { listSegments, evaluateSegment, FinzenApiError } from '../../clients/finzenApi';
import type { KaizenTool } from './guard';

// ─────────────────────────────────────────────────────────────────────────
// Tools de segmentos — capa semántica curada por FinZen (DISENO_FASE1.md §6).
// El agente NUNCA ejecuta SQL: solo elige un slug del catálogo y lo evalúa.
// Los counts ya vienen con los opt-outs de marketing descontados = alcance real.
// ─────────────────────────────────────────────────────────────────────────

export const listSegmentsTool: KaizenTool = {
  name: 'list_segments',
  description:
    'Devuelve el catálogo de segmentos curados de usuarios (slug, descripción y parámetros combinables: plans, platforms, country, days). ' +
    'El catálogo puede crecer: consúltalo EN VIVO, no asumas que conoces los slugs. Es el primer paso para elegir a quién dirigir una campaña.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute() {
    const segments = await listSegments();
    return JSON.stringify(segments);
  },
};

export const evaluateSegmentTool: KaizenTool = {
  name: 'evaluate_segment',
  description:
    'Evalúa un segmento y devuelve su tamaño real (count), YA con los opt-outs de marketing descontados (ese es el alcance real de una campaña). ' +
    'LLÁMALA SIEMPRE antes de proponer una campaña. Acepta filtros combinables (plans, platforms, country, days) para afinar el segmento sin inventar uno nuevo.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'slug del catálogo (ej. never_activated, dormant, budget_exceeded, trial_ending, active)' },
      plans: { type: 'string', description: 'CSV de FREE,PREMIUM,PRO (opcional; default: todos)' },
      platforms: { type: 'string', description: 'CSV de IOS,ANDROID (opcional; default: ambas)' },
      country: { type: 'string', description: 'País exacto (opcional; default: todos)' },
      days: { type: 'number', description: 'Ventana en días para dormant/active/trial_ending (opcional)' },
    },
    required: ['slug'],
  },
  async execute(input) {
    const slug = input.slug as string | undefined;
    if (!slug || slug.trim().length === 0) {
      throw new Error('Falta el parámetro "slug". Llama primero a list_segments para ver los slugs disponibles.');
    }

    const params: Record<string, string | number> = {};
    if (input.plans) params.plans = input.plans as string;
    if (input.platforms) params.platforms = input.platforms as string;
    if (input.country) params.country = input.country as string;
    if (input.days !== undefined) params.days = input.days as number;

    try {
      const evaluation = await evaluateSegment(slug, params);
      return JSON.stringify(evaluation);
    } catch (err) {
      // 404 = slug inexistente. Devolver los slugs válidos para que el modelo corrija.
      if (err instanceof FinzenApiError && err.status === 404) {
        let available = '';
        try {
          const segments = await listSegments();
          available = segments.map((s) => s.slug).join(', ');
        } catch {
          /* si además falla el catálogo, seguimos con el mensaje base */
        }
        throw new Error(
          `El segmento "${slug}" no existe en el catálogo.` +
            (available ? ` Segmentos disponibles: ${available}. Usa uno de esos` : ' Llama a list_segments para ver los válidos') +
            ', o si de verdad hace falta uno nuevo, dilo al socio para que FinZen lo agregue (no lo simules con otro).',
        );
      }
      throw err;
    }
  },
};
