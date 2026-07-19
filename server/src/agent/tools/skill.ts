import { getSkillBody, availableSlugs } from '../skills';
import type { KaizenTool } from './guard';

// ─────────────────────────────────────────────────────────────────────────
// load_skill — la novena tool (DISENO_FASE1.md §15). Devuelve el cuerpo
// completo del playbook de un skill para que el agente siga su método. El
// catálogo (qué skills hay y cuándo usarlos) ya vive en el system prompt; esta
// tool entrega el detalle bajo demanda para no inflar el prompt.
//
// Los skills NUNCA anulan las reglas duras del system prompt (esa instrucción
// va en el prompt, junto al catálogo).
// ─────────────────────────────────────────────────────────────────────────

export const loadSkillTool: KaizenTool = {
  name: 'load_skill',
  description:
    'Carga el método (playbook) de un skill por su slug y síguelo. Úsalo ANTES de ejecutar una tarea cubierta por un skill (ver "Skills disponibles" en tus instrucciones), ' +
    'por ejemplo antes de diseñar una campaña de retención, escribir un push o leer un lift. Los skills nunca anulan tus reglas duras.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'slug del skill a cargar (ej. copy-push, campanas-retencion, diseno-experimentos)' },
    },
    required: ['slug'],
  },
  async execute(input) {
    const slug = (input.slug as string | undefined)?.trim();
    if (!slug) {
      throw new Error(`Falta el parámetro "slug". Skills disponibles: ${availableSlugs().join(', ')}.`);
    }
    const body = getSkillBody(slug);
    if (!body) {
      throw new Error(`No existe el skill "${slug}". Skills disponibles: ${availableSlugs().join(', ')}.`);
    }
    return body;
  },
};
