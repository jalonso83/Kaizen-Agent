import cron from 'node-cron';
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
    `3. Escribí el resumen: 3-5 movimientos con cifras (comparando ambas semanas), los resultados de campañas medidas (lift y qué significa), y 2-3 recomendaciones accionables con el dato que las respalda.\n` +
    `4. Identificá la mejor oportunidad de campaña de la semana según los datos, y proponela EN TEXTO — mismo método que usás en el chat normal (evaluate_segment para el count real, carga los skills campanas-retencion/copy-push/diseno-experimentos, un mensaje principal + 1-2 alternativas con Título y Mensaje, racional con datos, qué se mediría). NO llames a propose_campaign ni generes ninguna tarjeta — no está disponible en esta corrida y no corresponde: esto es una recomendación escrita para que el socio la lea y, si le interesa, la pida por chat luego. Si de verdad ningún segmento muestra una oportunidad clara esta semana, decilo en vez de forzar una idea débil.\n` +
    `5. Guardá el resumen COMPLETO —incluida la propuesta de campaña del paso 4, o la nota de que no hubo una oportunidad clara— con save_content_draft (folder="assets", title="Resumen semanal ${reportWeek.to}"). Es la única forma en que el socio va a ver esto: esta conversación es interna, nadie la lee por chat.\n` +
    `</evento_sistema>`
  );
}

export type WeeklySummaryResult =
  | { ok: true; from: string; to: string }
  | { ok: false; error: string };

// Guard simple anti-concurrencia: solo existe UNA conversación de cron (ver
// ensureCronConversation), así que dos corridas superpuestas — el cron
// disparando justo cuando alguien pulsa "forzar ahora" — escribirían sobre el
// mismo hilo de mensajes a la vez. Un booleano en memoria alcanza: un solo
// proceso, sin necesidad de un lock en BD.
let isRunning = false;

export async function runWeeklySummary(): Promise<WeeklySummaryResult> {
  if (isRunning) {
    return { ok: false, error: 'Ya hay una corrida del resumen semanal en curso — esperá a que termine.' };
  }
  isRunning = true;

  const startedAt = Date.now();
  let conversationId: string | undefined;

  try {
    if (!config.anthropicApiKey) {
      console.warn('[weekly-summary] Sin ANTHROPIC_API_KEY configurada — se omite la corrida.');
      return { ok: false, error: 'Kaizen todavía no tiene configurada la key de Anthropic.' };
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

    // Persistir cada mensaje del assistant apenas está listo, ANTES de que el
    // runner ejecute su tool_use — mismo fix que runner.ts (2026-08-07): si se
    // acumula todo para persistir después del loop completo, una tool que
    // escribe algo con su propio timestamp queda con un createdAt anterior al
    // del mensaje que la generó.
    for await (const message of runner) {
      await persistAssistantMessage(conversationId, message);
    }

    // Los tool_result ('user') que el runner generó entre rondas.
    const newMessages = runner.params.messages.slice(baseLen);
    for (const msg of newMessages) {
      if (msg.role === 'user') {
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
    return { ok: true, from: reportWeek.from, to: reportWeek.to };
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
    return { ok: false, error: message };
  } finally {
    isRunning = false;
  }
}

/** Programa la corrida (lunes 8am RD). No corre nada al llamarla — solo agenda. */
export function startWeeklySummaryCron(): void {
  cron.schedule(CRON_SCHEDULE, () => void runWeeklySummary(), { timezone: 'UTC' });
}
