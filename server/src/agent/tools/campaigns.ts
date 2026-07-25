import { db } from '../../db';
import { config } from '../../config';
import { audit } from '../../services/audit';
import { createCampaignDraft, getKpis, FinzenApiError, type CampaignDraftInput } from '../../clients/finzenApi';
import type { KaizenTool, ToolContext } from './guard';

// Taxonomía de tipo de mensaje (2026-07-24, a pedido del socio — pendiente de
// validar con marketing de FinZen). Ver get_message_type_performance: cruza
// esto contra el lift real para que Kaizen "aprenda" con estadística
// acumulada real, no con un modelo que se entrena solo.
export const MESSAGE_TYPES = [
  'urgencia',
  'educativo',
  'incentivo',
  'social_proof',
  'pregunta_directa',
  'otro',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────
// El gate de confirmación — DISENO_FASE1.md §7 (la pieza más importante de la
// fase). Dos tools separadas a propósito: propose_campaign solo escribe en
// nuestra BD (nunca toca FinZen); create_campaign_draft recibe SOLO
// { proposal_id } y carga el payload YA confirmado desde la BD — el modelo no
// puede alterar título/mensaje/segmento después de la confirmación porque no
// hay parámetros que alterar. La transición PROPOSED → CONFIRMED la escribe
// EXCLUSIVAMENTE el endpoint HTTP del botón (routes/proposals.ts), nunca el
// modelo por chat — por eso ninguna instrucción en la conversación puede
// saltarse el gate (ver "Por qué es imposible saltárselo", §7).
// ─────────────────────────────────────────────────────────────────────────

const CONFIRM_TTL_MS = 30 * 60 * 1000; // 30 min (§7)

interface ValidatedProposal {
  campaignInput: CampaignDraftInput;
  segmentCount: number;
  expectedMeasurement: string;
  messageType: MessageType;
}

/** Mismas reglas que PRD §4.4 — el error debe llegar al proponer, no al ejecutar. */
function validateProposalInput(input: Record<string, unknown>): ValidatedProposal {
  const title = input.title as string | undefined;
  const message = input.message as string | undefined;
  const segment_slug = input.segment_slug as string | undefined;
  const rationale = input.rationale as string | undefined;
  const expected_measurement = input.expected_measurement as string | undefined;
  const message_type = input.message_type as string | undefined;
  const segment_count = input.segment_count;
  const surface = input.surface as string | undefined;
  const holdout_pct = input.holdout_pct as number | undefined;
  const segment_params = input.segment_params as Record<string, string | number> | undefined;

  if (!title || title.length === 0 || title.length > 100) {
    throw new Error('"title" es requerido y debe tener ≤100 caracteres.');
  }
  if (!message || message.length === 0 || message.length > 200) {
    throw new Error('"message" es requerido y debe tener ≤200 caracteres.');
  }
  if (!segment_slug) {
    throw new Error('Falta "segment_slug". Usa list_segments para ver los slugs disponibles.');
  }
  if (!rationale || rationale.trim().length < 10) {
    throw new Error('"rationale" es requerido y debe tener al menos 10 caracteres — justifica la propuesta con datos de los tools.');
  }
  if (!expected_measurement || expected_measurement.trim().length < 5) {
    throw new Error('Falta "expected_measurement": describe qué se va a medir (holdout elegido y ventana) y cómo vas a saber si funcionó.');
  }
  if (!message_type || !MESSAGE_TYPES.includes(message_type as MessageType)) {
    throw new Error(`"message_type" es requerido y debe ser uno de: ${MESSAGE_TYPES.join(', ')}.`);
  }
  if (typeof segment_count !== 'number' || !Number.isInteger(segment_count) || segment_count < 0) {
    throw new Error('"segment_count" debe ser el conteo real (entero ≥0) que devolvió evaluate_segment — no lo estimes.');
  }
  if (surface !== undefined && !['push', 'slot', 'both'].includes(surface)) {
    throw new Error('"surface" debe ser "push", "slot" o "both".');
  }
  if (holdout_pct !== undefined && (typeof holdout_pct !== 'number' || holdout_pct < 0 || holdout_pct > 100)) {
    throw new Error('"holdout_pct" debe estar entre 0 y 100.');
  }

  return {
    campaignInput: {
      title,
      message,
      segment_slug,
      segment_params,
      rationale,
      surface: surface as CampaignDraftInput['surface'],
      holdout_pct,
    },
    segmentCount: segment_count,
    expectedMeasurement: expected_measurement,
    messageType: message_type as MessageType,
  };
}

export const proposeCampaignTool: KaizenTool = {
  name: 'propose_campaign',
  description:
    'Registra una propuesta de campaña en la tarjeta del chat para que el socio la confirme o rechace. NO envía nada a FinZen — eso solo pasa después, con create_campaign_draft, y solo si el socio confirmó. ' +
    'Llama SIEMPRE después de evaluar el segmento real (evaluate_segment) y consultar KPIs/resultados de campañas comparables. Antes de elegir message_type, considera consultar get_message_type_performance para ver qué tipo tuvo mejor lift histórico. ' +
    'Una propuesta nueva reemplaza (SUPERSEDED) cualquier propuesta pendiente anterior de esta conversación.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Nombre interno de la campaña, ≤100 caracteres' },
      message: { type: 'string', description: 'Copy que ve el usuario final, ≤200 caracteres' },
      segment_slug: { type: 'string', description: 'slug del catálogo (ver list_segments)' },
      segment_params: { type: 'object', description: 'Filtros del segmento (plans, platforms, country, days) — opcional' },
      rationale: { type: 'string', description: 'Por qué este segmento, ahora, con este mensaje — con cifras (≥10 caracteres)' },
      segment_count: { type: 'number', description: 'Count real devuelto por evaluate_segment — no lo inventes' },
      expected_measurement: { type: 'string', description: 'Qué se va a medir: el holdout elegido, por qué, y en qué ventana' },
      message_type: {
        type: 'string',
        enum: [...MESSAGE_TYPES],
        description:
          'Categoría del enfoque del mensaje — urgencia (apremio, "hoy"/"ya"), educativo (explica un concepto/beneficio), ' +
          'incentivo (premio/descuento/gamificación), social_proof ("otros usuarios ya..."), pregunta_directa (interpela al usuario), otro.',
      },
      surface: { type: 'string', enum: ['push', 'slot', 'both'], description: 'Default: push' },
      holdout_pct: { type: 'number', description: '0-100. No asumas 10% de memoria — ver skill diseno-experimentos' },
    },
    required: ['title', 'message', 'segment_slug', 'rationale', 'segment_count', 'expected_measurement', 'message_type'],
  },
  async execute(input, ctx: ToolContext) {
    if (!ctx.conversationId) {
      throw new Error('propose_campaign requiere una conversación activa (no disponible en corridas sin chat, como el cron).');
    }
    const { campaignInput, segmentCount, expectedMeasurement, messageType } = validateProposalInput(input);

    const proposal = await db.$transaction(async (tx) => {
      // Cualquier PROPOSED anterior de esta conversación queda reemplazado (§7).
      await tx.proposal.updateMany({
        where: { conversationId: ctx.conversationId!, status: 'PROPOSED' },
        data: { status: 'SUPERSEDED' },
      });
      return tx.proposal.create({
        data: {
          conversationId: ctx.conversationId!,
          status: 'PROPOSED',
          payload: campaignInput as object,
          segmentCount,
          expectedMeasurement,
          messageType,
        },
      });
    });

    ctx.sse?.send('proposal', proposal);

    return (
      `Propuesta registrada (id ${proposal.id}). El socio verá una tarjeta con botón Confirmar. ` +
      'NO llames a create_campaign_draft hasta que el sistema te indique que fue confirmada.'
    );
  },
};

export const createCampaignDraftTool: KaizenTool = {
  name: 'create_campaign_draft',
  description:
    'Crea el borrador REAL en FinZen (PENDING_APPROVAL) a partir de una propuesta ya CONFIRMADA por el socio. ' +
    'Recibe SOLO proposal_id — el título/mensaje/segmento salen de la BD, no de este llamado. ' +
    'Si el socio todavía no confirmó (no hay evento de confirmación en esta conversación), esta tool falla con un error de gate — no insistas, pídele que confirme en la tarjeta.',
  inputSchema: {
    type: 'object',
    properties: {
      proposal_id: { type: 'string', description: 'id de la propuesta ya confirmada' },
    },
    required: ['proposal_id'],
  },
  async execute(input, ctx: ToolContext) {
    const proposalId = input.proposal_id as string | undefined;
    if (!proposalId) {
      throw new Error('Falta "proposal_id".');
    }

    const proposal = await db.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.conversationId !== ctx.conversationId) {
      throw new Error(
        `No encontré la propuesta "${proposalId}" en esta conversación. Verifica el id, o vuelve a proponer con propose_campaign.`,
      );
    }

    if (proposal.status !== 'CONFIRMED') {
      await audit.log({
        conversationId: ctx.conversationId,
        actor: 'agent',
        action: 'gate:denied',
        input: { proposal_id: proposalId, status: proposal.status },
        resultSummary: `Intento de create_campaign_draft sin confirmación (status=${proposal.status}).`,
        isError: true,
      });
      throw new Error(
        'GATE: el socio aún NO confirmó esta propuesta. No insistas ni la crees igual; pídele que pulse "Confirmar" en la tarjeta.',
      );
    }

    const confirmedAtMs = proposal.confirmedAt?.getTime() ?? 0;
    if (Date.now() - confirmedAtMs > CONFIRM_TTL_MS) {
      await db.proposal.update({ where: { id: proposal.id }, data: { status: 'EXPIRED' } });
      throw new Error(
        'La confirmación expiró (pasaron más de 30 minutos). Pídele al socio que confirme de nuevo desde la tarjeta.',
      );
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const attemptedToday = await db.proposal.count({
      where: { status: { in: ['EXECUTED', 'UNKNOWN_OUTCOME'] }, createdAt: { gte: startOfDay } },
    });
    if (attemptedToday >= config.kaizenMaxDraftsPerDay) {
      throw new Error(
        `Se alcanzó el límite de ${config.kaizenMaxDraftsPerDay} borradores diarios. NO reintentes hoy; informa al socio que podrá crearse mañana.`,
      );
    }

    // CAS anti doble-ejecución: solo una llamada puede ganar la transición.
    const cas = await db.proposal.updateMany({
      where: { id: proposal.id, status: 'CONFIRMED' },
      data: { status: 'EXECUTING' },
    });
    if (cas.count === 0) {
      throw new Error('Esta propuesta ya fue procesada por otra ejecución — no la reintentes ni la dupliques.');
    }

    try {
      const result = await createCampaignDraft(proposal.payload as unknown as CampaignDraftInput);
      await db.proposal.update({
        where: { id: proposal.id },
        data: { status: 'EXECUTED', finzenCampaignId: result.id, executedAt: new Date() },
      });
      return (
        `Borrador creado en FinZen (id ${result.id}). Avisa al socio: queda pendiente de aprobación humana en el panel de FinZen — Kaizen nunca envía directamente.`
      );
    } catch (err) {
      if (err instanceof FinzenApiError && err.status === 429) {
        await db.proposal.update({ where: { id: proposal.id }, data: { status: 'REJECTED', error: err.message } });
        throw new Error(`FinZen rechazó el borrador (límite diario de FinZen alcanzado): ${err.message}. Avisa al socio.`);
      }
      const message = err instanceof Error ? err.message : String(err);
      await db.proposal.update({ where: { id: proposal.id }, data: { status: 'UNKNOWN_OUTCOME', error: message } });
      throw new Error(
        'No se pudo confirmar si el borrador se creó en FinZen (falla de red o timeout a mitad del POST). ' +
          'Pide a un humano que verifique en el panel de FinZen antes de reintentar — esto ya cuenta contra el límite diario.',
      );
    }
  },
};

export const getMessageTypePerformanceTool: KaizenTool = {
  name: 'get_message_type_performance',
  description:
    'Agrega el lift real (vs holdout) de las campañas que Kaizen propuso y ejecutó, agrupado por message_type, para ver qué enfoque de mensaje funcionó mejor históricamente. ' +
    'Úsala ANTES de elegir el message_type de una propuesta nueva, cuando ya haya campañas ejecutadas previas para comparar. ' +
    'Solo cubre campañas que Kaizen mismo propuso (con su tipo autoetiquetado) — campañas creadas antes de Kaizen o directo en el panel de FinZen no tienen tipo y no entran en el agregado.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute() {
    const proposals = await db.proposal.findMany({
      where: { status: 'EXECUTED', finzenCampaignId: { not: null } },
      select: { finzenCampaignId: true, messageType: true },
    });
    if (proposals.length === 0) {
      return JSON.stringify({
        results: [],
        note: 'Todavía no hay campañas propuestas por Kaizen con resultado ejecutado — no hay datos para agrupar por tipo.',
      });
    }

    // Rango amplio para cubrir todo el historial de Kaizen — get_kpis devuelve
    // máx. 20 campañas por llamada (PRD §4.2), así que solo las más recientes
    // entran; con el tiempo esto naturalmente cubre las campañas de Kaizen.
    const kpis = await getKpis({ from: '2020-01-01', to: new Date().toISOString().slice(0, 10) });
    const campaignById = new Map(kpis.campaigns.map((c) => [c.id, c]));

    const byType = new Map<string, { liftSum: number; count: number }>();
    let matched = 0;
    for (const p of proposals) {
      const campaign = campaignById.get(p.finzenCampaignId!);
      if (!campaign) continue; // fuera del rango que devolvió FinZen esta vez
      matched++;
      const type = p.messageType ?? 'sin_tipo';
      const acc = byType.get(type) ?? { liftSum: 0, count: 0 };
      acc.liftSum += campaign.lift_pts;
      acc.count += 1;
      byType.set(type, acc);
    }

    if (matched === 0) {
      return JSON.stringify({
        results: [],
        note: 'Las campañas ejecutadas por Kaizen no aparecen en el rango que devolvió get_kpis (puede que FinZen solo devuelva las últimas 20). No hay agregado confiable todavía.',
      });
    }

    const results = [...byType.entries()]
      .map(([message_type, { liftSum, count }]) => ({
        message_type,
        campaigns: count,
        avg_lift_pts: Math.round((liftSum / count) * 10) / 10,
      }))
      .sort((a, b) => b.avg_lift_pts - a.avg_lift_pts);

    return JSON.stringify({
      results,
      note: results.every((r) => r.campaigns < 3) ? 'Pocas campañas por tipo todavía — usar esta comparación con cautela.' : undefined,
    });
  },
};
