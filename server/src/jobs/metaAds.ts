import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { db } from '../db';
import { config } from '../config';
import { audit } from '../services/audit';
import { runAgentTurn } from '../agent/runner';
import { META_ADS_TOOL_LIST } from '../agent/tools';
import { runningConversations } from '../services/runningConversations';
import { TZ_RD, todayInRD } from '../util/fecha';
import { expresionCron, faltaParaCrear, postsUsados, segmentacionEfectiva } from '../services/publicidad';
import type { MetaAdsConfig } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────
// La publicidad automática (2026-10-04).
//
// Los días de la semana y a la hora elegidos en Configuración, Kaizen lee el
// Instagram de FinZen y la pauta de Meta, elige UN post que valga la pena
// promocionar y deja la tarjeta en la conversación elegida. Siempre tarjeta:
// acá no hay "modo directo" porque del otro lado hay dinero. Al confirmar, el
// código crea todo EN PAUSA y un humano lo activa en Ads Manager.
//
// Si la conversación está ocupada o falta configuración, se omite y se
// audita; no se encola.
// ─────────────────────────────────────────────────────────────────────────

let scheduledTask: ScheduledTask | null = null;
let isRunning = false;

export type MetaAdsResult = { ok: true; conversationId: string; tarjeta: string | null } | { ok: false; omitido: string };

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function buildPrompt(cfg: MetaAdsConfig, usados: string[]): string {
  const seg = segmentacionEfectiva(cfg);
  return (
    `<evento_sistema>Corrida automática de la PUBLICIDAD EN META (${todayInRD()}). Tu tarea: elegir UN post de Instagram de FinZen que valga la pena promocionar y dejar la tarjeta con propose_meta_ad, o explicar por qué hoy no.\n\n` +
    `Parámetros fijados por un admin (no los eliges ni los cambias): ${cfg.presupuestoDiario} USD/día durante ${cfg.duracionDias} días, objetivo ${cfg.objetivo}, ` +
    `${seg.paises.join('/')} de ${seg.edadMin} a ${seg.edadMax} años${seg.categoriaFinanciera ? ', categoría especial financiera' : ''}${cfg.urlDestino ? `, destino ${cfg.urlDestino}` : ''}.\n` +
    (usados.length ? `Posts ya propuestos o promocionados en los últimos ${cfg.rotacionDias} días (propose_meta_ad los rechaza): ${usados.join(', ')}.\n\n` : '\n') +
    `Hacé esto, en orden:\n` +
    `1. search_cerebro("decisions log") y search_cerebro("pauta Meta"): ubicate y descartá lo que ya se decidió no hacer.\n` +
    `2. Cargá los skills adquisicion-pagada y lectura-perfil-instagram.\n` +
    `3. list_marketing_accounts y get_instagram_profile sobre la cuenta de FinZen (la propia), con publicaciones: 50.\n` +
    `4. get_meta_campaigns y get_meta_spend de los últimos 30 días: qué está corriendo y qué gastó. Si ya hay campañas de Kaizen (nombre kaizen-ig-…) activas, tenelo en cuenta.\n` +
    `5. Elegí UN post: con interacciones claramente por encima de la mediana de la cuenta, que explique FinZen sin contexto (alguien que no te sigue lo tiene que entender), no promocionado antes, y preferentemente de los últimos 60 días. ` +
    `Escribí en el chat 3-5 líneas: qué post (permalink), por qué con cifras, y qué se va a medir. Después llamá a propose_meta_ad con su id exacto.\n` +
    `6. Si ningún post cumple, o la pauta actual ya cubre lo mismo, NO llames a propose_meta_ad: explicá en 2-3 líneas por qué. Es una respuesta válida.\n\n` +
    `Recordá: la tarjeta no gasta nada; al confirmar se crea EN PAUSA y la activa un humano en Ads Manager. Nunca digas que la campaña "ya está corriendo".` +
    `</evento_sistema>`
  );
}

export async function runMetaAds(opts: { forzar?: boolean } = {}): Promise<MetaAdsResult> {
  if (isRunning) return { ok: false, omitido: 'Ya hay una corrida de publicidad en curso.' };
  isRunning = true;
  const startedAt = Date.now();

  const omitir = async (motivo: string): Promise<MetaAdsResult> => {
    console.warn(`[meta-ads] omitida: ${motivo}`);
    await audit.log({ conversationId: null, actor: 'cron', action: 'cron:meta-ads', resultSummary: `omitida: ${motivo}`, isError: false, durationMs: Date.now() - startedAt });
    return { ok: false, omitido: motivo };
  };

  try {
    if (!config.anthropicApiKey) return await omitir('sin ANTHROPIC_API_KEY');
    const cfg = await db.metaAdsConfig.findUnique({ where: { id: 1 } });
    if (!cfg) return await omitir('la publicidad automática no está configurada');
    if (!cfg.enabled && !opts.forzar) return await omitir('la publicidad automática está apagada');
    const falta = faltaParaCrear();
    if (falta) return await omitir(falta);
    if (!cfg.conversationId) return await omitir('no hay conversación destino configurada');
    const conv = await db.conversation.findUnique({ where: { id: cfg.conversationId }, select: { id: true } });
    if (!conv) return await omitir(`la conversación destino ${cfg.conversationId} ya no existe; elegí otra en Configuración`);
    if (runningConversations.has(cfg.conversationId)) return await omitir('la conversación destino está ocupada en este momento');

    const usados = await postsUsados(cfg.rotacionDias);
    const inicio = new Date();
    const abort = new AbortController();
    runningConversations.add(cfg.conversationId, abort);
    try {
      await runAgentTurn(cfg.conversationId, buildPrompt(cfg, usados), undefined, abort.signal, {
        toolList: META_ADS_TOOL_LIST,
        restricciones: { origen: 'publicidad' },
        // Cerebro ×2 + skills ×2 + cuentas + perfil + Meta ×2 + propose ≈ 9.
        maxIterations: 14,
      });
    } finally {
      runningConversations.delete(cfg.conversationId);
    }

    const tarjeta = await db.adProposal.findFirst({
      where: { conversationId: cfg.conversationId, origen: 'programada', createdAt: { gte: inicio } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, nombre: true },
    });
    await audit.log({
      conversationId: cfg.conversationId,
      actor: 'cron',
      action: 'cron:meta-ads',
      resultSummary: `corrió en ${Date.now() - startedAt}ms · ${tarjeta ? `tarjeta ${tarjeta.nombre}` : 'sin tarjeta (Kaizen explicó por qué)'}`,
      isError: false,
      durationMs: Date.now() - startedAt,
    });
    return { ok: true, conversationId: cfg.conversationId, tarjeta: tarjeta?.id ?? null };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    await audit.log({ conversationId: null, actor: 'cron', action: 'cron:meta-ads', resultSummary: motivo.slice(0, 2000), isError: true, durationMs: Date.now() - startedAt });
    return { ok: false, omitido: motivo };
  } finally {
    isRunning = false;
  }
}

/** Programa (o reprograma) según la config. No corre nada al llamarla. */
export async function startMetaAdsCron(): Promise<void> {
  const cfg = await db.metaAdsConfig.findUnique({ where: { id: 1 } }).catch(() => null);
  const hora = cfg?.cronHour ?? 9;
  const dias = cfg?.diasSemana?.length ? cfg.diasSemana : [1];
  if (scheduledTask) {
    await scheduledTask.destroy();
    scheduledTask = null;
  }
  scheduledTask = cron.schedule(expresionCron(hora, dias), () => void runMetaAds(), { timezone: TZ_RD });
  console.log(
    `[meta-ads] programada ${dias.map((d) => DIAS[d]).join(', ')} a las ${String(hora).padStart(2, '0')}:00 hora RD (${cfg?.enabled ? 'encendida' : 'apagada'}).`,
  );
}
