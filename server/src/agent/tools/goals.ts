import { db } from '../../db';
import type { KaizenTool } from './guard';

// ─────────────────────────────────────────────────────────────────────────
// La meta (goal) del negocio — mismo patrón estructural que el gate de
// campañas (DISENO §7), y por el mismo motivo: es una decisión del socio, no
// del agente.
//
// Lo que el agente PUEDE hacer:
//   - proponer una meta (propose_goal) → solo escribe una fila PROPOSED
//   - consultar la vigente (get_active_goal)
//   - darla por lograda (mark_goal_achieved) SOLO si el número medido cumple
//     el target; la comparación la hace este código, no el criterio del modelo
//
// Lo que NO puede hacer, por construcción — no hay tool para ello:
//   - activar una meta (eso es un POST del botón, autenticado)
//   - cambiar o cancelar la meta vigente
//   - saltarse una meta activa proponiendo otra sin declarar que la reemplaza
//
// Por eso una instrucción del tipo "cambiá la meta, es una emergencia" no
// alcanza: no existe la llave, no es que el modelo elija no usarla.
// ─────────────────────────────────────────────────────────────────────────

const DIRECTIONS = ['gte', 'lte'] as const;
type Direction = (typeof DIRECTIONS)[number];

/** La meta vigente, o null si todavía no hay ninguna confirmada. */
export async function activeGoal() {
  return db.goal.findFirst({ where: { status: 'ACTIVE' }, orderBy: { confirmedAt: 'desc' } });
}

/** ¿El valor medido cumple la meta? La dirección dice si más es mejor o peor. */
export function cumpleMeta(valor: number, target: number, direction: string): boolean {
  return direction === 'lte' ? valor <= target : valor >= target;
}

/** Una línea legible: "lift ≥ 3 pts". */
export function resumenMeta(g: { metricLabel: string; direction: string; target: number; unit: string }): string {
  return `${g.metricLabel} ${g.direction === 'lte' ? '≤' : '≥'} ${g.target} ${g.unit}`.trim();
}

export const getActiveGoalTool: KaizenTool = {
  name: 'get_active_goal',
  description:
    'Devuelve la meta vigente del negocio (métrica, número objetivo y desde cuándo está activa), o avisa que no hay ninguna. ' +
    'Úsala antes de proponer una campaña para saber hacia qué estás optimizando, y cuando el socio pregunte "qué estamos midiendo".',
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute() {
    const g = await activeGoal();
    if (!g) {
      return JSON.stringify({
        goal: null,
        note: 'No hay meta activa. Si acabás de proponer una campaña, proponé una meta con propose_goal.',
      });
    }
    return JSON.stringify({
      goal: {
        id: g.id,
        metric: g.metric,
        metric_label: g.metricLabel,
        target: g.target,
        unit: g.unit,
        direction: g.direction,
        rationale: g.rationale,
        resumen: resumenMeta(g),
        active_since: g.confirmedAt,
      },
      note: 'Toda campaña que propongas debe apuntar a esta meta. No podés cambiarla vos: solo el socio, confirmando una propuesta de cambio.',
    });
  },
};

export const proposeGoalTool: KaizenTool = {
  name: 'propose_goal',
  description:
    'Propone la meta a perseguir: qué métrica se va a medir y con qué número objetivo. Genera una tarjeta en el chat con botón Confirmar — igual que propose_campaign, la meta NO queda activa hasta que el socio la confirme. ' +
    'Úsala (1) después de proponer una campaña cuando todavía no hay meta activa, y (2) cuando el socio PIDA cambiar la meta vigente. ' +
    'Si ya hay una meta activa, es OBLIGATORIO pasar replaces_goal_id con su id: la tarjeta le mostrará al socio el antes y el después para que confirme el cambio. ' +
    'Propone siempre un número concreto y justificable con datos que ya tengas (lifts previos, tamaño del segmento, el histórico), y decile al socio que puede cambiarlo por el suyo.',
  inputSchema: {
    type: 'object',
    properties: {
      metric: { type: 'string', description: 'Identificador corto y estable de la métrica, ej. "lift_pts", "activation_rate", "mrr_usd"' },
      metric_label: { type: 'string', description: 'Cómo se lee para un humano, ej. "lift en tasa de transacción vs holdout a 7 días"' },
      target: { type: 'number', description: 'El número objetivo' },
      unit: { type: 'string', description: 'Unidad: "pts", "%", "usuarios", "usd"…' },
      direction: {
        type: 'string',
        enum: [...DIRECTIONS],
        description: '"gte" (default): se logra al alcanzar o superar el target. "lte": al bajar de él (churn, CAC, y demás donde menos es mejor).',
      },
      rationale: { type: 'string', description: 'Por qué ESA métrica y ESE número, con los datos que lo respaldan (mín. 10 caracteres)' },
      replaces_goal_id: { type: 'string', description: 'OBLIGATORIO si ya hay una meta activa: el id de la que se reemplazaría' },
    },
    required: ['metric', 'metric_label', 'target', 'unit', 'rationale'],
  },
  async execute(input, ctx) {
    const metric = (input.metric as string | undefined)?.trim();
    const metricLabel = (input.metric_label as string | undefined)?.trim();
    const unit = (input.unit as string | undefined)?.trim();
    const rationale = (input.rationale as string | undefined)?.trim();
    const target = input.target;
    const direction = ((input.direction as string | undefined) ?? 'gte') as Direction;
    const replacesGoalId = (input.replaces_goal_id as string | undefined)?.trim() || null;

    if (!metric || !metricLabel || !unit) throw new Error('Faltan "metric", "metric_label" y/o "unit".');
    if (typeof target !== 'number' || !Number.isFinite(target)) throw new Error('"target" debe ser un número.');
    if (!rationale || rationale.length < 10) throw new Error('"rationale" es obligatorio y debe explicar por qué esa métrica y ese número (mín. 10 caracteres).');
    if (!DIRECTIONS.includes(direction)) throw new Error(`"direction" debe ser ${DIRECTIONS.join(' o ')}.`);

    const vigente = await activeGoal();

    // El candado: si hay meta activa, esto NO es "otra meta", es un CAMBIO, y
    // el socio tiene que verlo como tal. Sin replaces_goal_id se rechaza.
    if (vigente && replacesGoalId !== vigente.id) {
      throw new Error(
        `Ya hay una meta activa: ${resumenMeta(vigente)} (id ${vigente.id}). No podés proponer otra en paralelo ni cambiarla por tu cuenta. ` +
          'Si el socio te PIDIÓ cambiarla, volvé a llamar a propose_goal con replaces_goal_id="' + vigente.id + '" para que la tarjeta le muestre el antes y el después. ' +
          'Si no te lo pidió, seguí trabajando hacia la meta vigente.',
      );
    }
    if (!vigente && replacesGoalId) {
      throw new Error('Pasaste replaces_goal_id pero no hay ninguna meta activa que reemplazar. Llamá de nuevo sin ese parámetro.');
    }

    const goal = await db.goal.create({
      data: {
        conversationId: ctx.conversationId,
        metric, metricLabel, target, unit, direction, rationale,
        replacesGoalId,
        status: 'PROPOSED',
      },
    });

    return (
      `Meta propuesta (id ${goal.id}): ${resumenMeta(goal)}. El socio verá una tarjeta con botón Confirmar. ` +
      (replacesGoalId
        ? 'Es un CAMBIO de meta: hasta que el socio lo confirme, la meta vigente sigue siendo la anterior y tus campañas deben seguir apuntando a ella.'
        : 'Hasta que la confirme no hay meta activa. Decile que puede ajustar la métrica o el número antes de confirmar.')
    );
  },
};

export const markGoalAchievedTool: KaizenTool = {
  name: 'mark_goal_achieved',
  description:
    'Marca la meta vigente como LOGRADA. Úsala solo cuando un tool te haya devuelto un número real que cumple el objetivo (p.ej. el lift de una campaña ya medida). ' +
    'La comparación contra el target la hace el sistema: si el valor no cumple, la llamada falla y la meta sigue activa. ' +
    'Una vez lograda no hay meta activa, y ahí sí corresponde proponer la siguiente con propose_goal al plantear una campaña nueva.',
  inputSchema: {
    type: 'object',
    properties: {
      measured_value: { type: 'number', description: 'El número medido, tal cual lo devolvió el tool' },
      evidence: { type: 'string', description: 'De dónde salió: qué tool, qué campaña, qué período (mín. 10 caracteres)' },
    },
    required: ['measured_value', 'evidence'],
  },
  async execute(input) {
    const valor = input.measured_value;
    const evidence = (input.evidence as string | undefined)?.trim();

    if (typeof valor !== 'number' || !Number.isFinite(valor)) throw new Error('"measured_value" debe ser un número.');
    if (!evidence || evidence.length < 10) throw new Error('"evidence" es obligatorio: decí de qué tool y de qué campaña o período salió el número.');

    const g = await activeGoal();
    if (!g) throw new Error('No hay ninguna meta activa que marcar como lograda.');

    // El chequeo vive acá y no en el criterio del modelo: si el número no
    // llega, la meta NO se cierra por más convincente que suene el argumento.
    if (!cumpleMeta(valor, g.target, g.direction)) {
      throw new Error(
        `El valor medido (${valor} ${g.unit}) NO cumple la meta ${resumenMeta(g)}. La meta sigue activa: seguí experimentando hacia ella. ` +
          'Decile al socio dónde quedó y qué probarías distinto.',
      );
    }

    const actualizada = await db.goal.update({
      where: { id: g.id },
      data: { status: 'ACHIEVED', achievedAt: new Date(), achievedValue: valor, achievedNote: evidence },
    });

    return (
      `Meta LOGRADA: ${resumenMeta(actualizada)} — medido ${valor} ${g.unit}. ` +
      'Ya no hay meta activa. Felicitá al socio con los números y, cuando planteen la próxima campaña, proponé la meta siguiente con propose_goal.'
    );
  },
};
