import cron from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { config } from '../config';
import { audit } from '../services/audit';
import { getClient, MODEL } from '../agent/runner';
import { buildBetaTools } from '../agent/adapter';
import { buildSystemPrompt } from '../agent/systemPrompt';
import { getTonoDeMarca } from '../agent/tono';
import { CRON_TOOL_LIST } from '../agent/tools';
import type { ToolContext } from '../agent/tools/guard';
import { buildHistory, persistUserText, persistAssistantMessage, persistToolResultMessage } from '../agent/history';

// ─────────────────────────────────────────────────────────────────────────
// Resumen semanal automático — DISENO_FASE1.md §12 (+ addendum de
// configuración, 2026-07-22). Corre lunes 8am RD (`0 12 * * 1` UTC).
//
// Reglas del diseño:
//  - Corrida SIN usuario, sobre una conversación interna de un partner-sistema
//    `kaizen-cron` — todo queda auditado/revisable igual que cualquier chat.
//  - SIN tools de escritura hacia FinZen (CRON_TOOL_LIST excluye
//    propose_campaign/create_campaign_draft) — un cron no debe *poder* crear
//    borradores, ni por un bug de prompt.
//  - `stream: false` (nadie mirando en vivo) y nunca tumba el proceso: un
//    fallo se audita y se loguea, la próxima corrida programada sigue en pie.
// ─────────────────────────────────────────────────────────────────────────

const CRON_SCHEDULE = '0 12 * * 1'; // lunes 12:00 UTC = 8:00am RD (UTC-4)
const CRON_PARTNER_EMAIL = 'kaizen-cron@system.internal';

interface WeekRange {
  from: string;
  to: string;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function startOfCalendarWeek(reference: Date, weekStartDay: number): Date {
  const d = new Date(reference);
  const diff = (d.getDay() - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Calcula el rango de la semana a reportar y el de la anterior (comparación),
 * según la config (rolling: últimos 7 días; calendar: última semana COMPLETA
 * según weekStartDay, no la parcial en curso — mismo criterio ya usado en
 * get_kpis(week_mode), PRD §4.2).
 */
export function computeWeekRanges(
  weekMode: string,
  weekStartDay: number,
  now: Date,
): { reportWeek: WeekRange; priorWeek: WeekRange } {
  if (weekMode === 'rolling') {
    const reportTo = new Date(now);
    const reportFrom = addDays(reportTo, -6);
    const priorTo = addDays(reportFrom, -1);
    const priorFrom = addDays(priorTo, -6);
    return { reportWeek: { from: fmt(reportFrom), to: fmt(reportTo) }, priorWeek: { from: fmt(priorFrom), to: fmt(priorTo) } };
  }

  const startOfCurrent = startOfCalendarWeek(now, weekStartDay);
  const reportTo = addDays(startOfCurrent, -1);
  const reportFrom = addDays(reportTo, -6);
  const priorTo = addDays(reportFrom, -1);
  const priorFrom = addDays(priorTo, -6);
  return { reportWeek: { from: fmt(reportFrom), to: fmt(reportTo) }, priorWeek: { from: fmt(priorFrom), to: fmt(priorTo) } };
}

async function ensureCronPartner(): Promise<string> {
  const existing = await db.partner.findUnique({ where: { email: CRON_PARTNER_EMAIL } });
  if (existing) return existing.id;
  // Password inutilizable a propósito (nadie necesita loguearse con esto) +
  // disabled:true como cinturón extra — requireAuth rechaza cuentas disabled.
  const passwordHash = await bcrypt.hash(randomUUID(), 12);
  const created = await db.partner.create({
    data: { email: CRON_PARTNER_EMAIL, name: 'Kaizen (cron)', passwordHash, disabled: true },
  });
  return created.id;
}

async function ensureCronConversation(partnerId: string): Promise<string> {
  const existing = await db.conversation.findFirst({ where: { partnerId }, orderBy: { createdAt: 'asc' } });
  if (existing) return existing.id;
  const created = await db.conversation.create({ data: { partnerId, title: 'Resumen semanal (cron)' } });
  return created.id;
}

function buildCronPrompt(reportWeek: WeekRange, priorWeek: WeekRange): string {
  return (
    `<evento_sistema>Corrida automática del resumen semanal (cron, lunes).\n` +
    `Semana a reportar: ${reportWeek.from} a ${reportWeek.to}. Semana anterior, para comparar: ${priorWeek.from} a ${priorWeek.to}.\n\n` +
    `Hacé esto, en orden:\n` +
    `1. get_kpis para la semana a reportar (from=${reportWeek.from}, to=${reportWeek.to}) y de nuevo para la semana anterior (from=${priorWeek.from}, to=${priorWeek.to}).\n` +
    `2. get_campaign_results para la semana a reportar.\n` +
    `3. Escribí el resumen: 3-5 movimientos con cifras (comparando ambas semanas), los resultados de campañas medidas (lift y qué significa), y 2-3 recomendaciones accionables con el dato que las respalda. Si una recomendación implica una campaña, describila con el count real del segmento (evaluate_segment) pero NO la propongas ni la crees — esto es un reporte, no un propose_campaign.\n` +
    `4. Guardá el resumen completo con save_content_draft (folder="assets", title="Resumen semanal ${reportWeek.to}").\n` +
    `</evento_sistema>`
  );
}

export async function runWeeklySummary(): Promise<void> {
  const startedAt = Date.now();
  let conversationId: string | undefined;

  try {
    if (!config.anthropicApiKey) {
      console.warn('[weekly-summary] Sin ANTHROPIC_API_KEY configurada — se omite la corrida.');
      return;
    }

    const cfg = await db.weeklySummaryConfig.findUnique({ where: { id: 1 } });
    const weekMode = cfg?.weekMode ?? 'calendar';
    const weekStartDay = cfg?.weekStartDay ?? 1;
    const { reportWeek, priorWeek } = computeWeekRanges(weekMode, weekStartDay, new Date());

    const partnerId = await ensureCronPartner();
    conversationId = await ensureCronConversation(partnerId);

    await persistUserText(conversationId, buildCronPrompt(reportWeek, priorWeek));

    const messages = await buildHistory(conversationId);
    const baseLen = messages.length;
    const ctx: ToolContext = { conversationId, sse: undefined };
    const tonoDeMarca = await getTonoDeMarca().catch(() => undefined);

    const runner = getClient().beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16_000,
      system: buildSystemPrompt(tonoDeMarca),
      tools: buildBetaTools(ctx, CRON_TOOL_LIST),
      messages,
      stream: false,
      max_iterations: 12,
    });

    const assistants: Anthropic.Beta.BetaMessage[] = [];
    for await (const message of runner) {
      assistants.push(message);
    }

    const newMessages = runner.params.messages.slice(baseLen);
    let assistantIdx = 0;
    for (const msg of newMessages) {
      if (msg.role === 'assistant') {
        const rich = assistants[assistantIdx++];
        if (rich) {
          await persistAssistantMessage(conversationId, rich);
        } else {
          await persistToolResultMessage(conversationId, msg.content);
        }
      } else {
        await persistToolResultMessage(conversationId, msg.content);
      }
    }

    await audit.log({
      conversationId,
      actor: 'cron',
      action: 'weekly-summary:done',
      resultSummary: `Semana ${reportWeek.from} a ${reportWeek.to} (weekMode=${weekMode})`,
      durationMs: Date.now() - startedAt,
    });
    console.log(`[weekly-summary] listo en ${Date.now() - startedAt}ms — semana ${reportWeek.from} a ${reportWeek.to}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[weekly-summary] Falló la corrida:', message);
    await audit
      .log({
        conversationId: conversationId ?? null,
        actor: 'cron',
        action: 'weekly-summary:error',
        resultSummary: message.slice(0, 2000),
        isError: true,
        durationMs: Date.now() - startedAt,
      })
      .catch(() => undefined);
  }
}

/** Programa la corrida (lunes 8am RD). No corre nada al llamarla — solo agenda. */
export function startWeeklySummaryCron(): void {
  cron.schedule(CRON_SCHEDULE, () => void runWeeklySummary(), { timezone: 'UTC' });
}
