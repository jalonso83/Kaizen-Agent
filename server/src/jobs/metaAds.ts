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
import { historialParaAprender } from '../services/resultadosAnuncios';
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

function buildPrompt(cfg: MetaAdsConfig, usados: string[], historial: string): string {
  const seg = segmentacionEfectiva(cfg);
  return (
    `<evento_sistema>Corrida automática de la PUBLICIDAD EN META (${todayInRD()}). Tu tarea: elegir UN post de Instagram de FinZen que valga la pena promocionar y dejar la tarjeta con propose_meta_ad, o explicar por qué hoy no.\n\n` +
    `Parámetros fijados por un admin (no los eliges ni los cambias): ${cfg.presupuestoDiario} USD/día durante ${cfg.duracionDias} días, objetivo ${cfg.objetivo}, ` +
    `${seg.paises.join('/')} de ${seg.edadMin} a ${seg.edadMax} años${seg.categoriaFinanciera ? ', categoría especial financiera' : ''}${cfg.urlDestino ? `, destino ${cfg.urlDestino}` : ''}.\n` +
    (usados.length ? `Posts ya propuestos o promocionados en los últimos ${cfg.rotacionDias} días (propose_meta_ad los rechaza): ${usados.join(', ')}.\n\n` : '\n') +
    (historial
      ? `Cómo rindieron los anuncios anteriores de Kaizen (calculado en código; usalo para elegir y no repitas lo que no funcionó):\n${historial}\n\n`
      : 'Todavía no hay resultados de anuncios anteriores de Kaizen.\n\n') +
    `Hacé esto, en orden:\n` +
    `1. Cargá el skill pautas-meta (el método de Junior: manda sobre cualquier otro) y adquisicion-pagada para los campos.\n` +
    `2. search_cerebro("registro experimentos pautas") y search_cerebro("decisions log"): qué experimento va (EXP-P0N), cuál fue el último y qué ya se descartó. Si no encontrás el registro, decilo.\n` +
    `3. get_meta_campaigns: si hay un experimento corriendo en la cuenta, NO propongas otro encima (se pisan y ninguno se puede leer). Explicalo en 2 líneas y terminá.\n` +
    `4. list_marketing_accounts y get_instagram_profile sobre la cuenta de FinZen (la propia), con publicaciones: 50. Si hay resultados de anuncios anteriores, get_meta_ad_results sin ad_id.\n` +
    `5. Elegí UNA pieza con el filtro de pautas-meta: moneda social orgánica a 7 días por encima de la mediana de su cuenta y formato, nunca pautada, que retenga los 3 primeros segundos y sin música que Meta pueda silenciar. Si la tool no trae compartidos, guardados o alcance, decilo: no lo reemplaces con likes.\n` +
    `6. Escribí en el chat la FICHA del experimento (código, hipótesis, la única variable, comparador, presupuesto y fechas, métrica principal, umbral en tres franjas, predicción con confianza, confusores, fecha de lectura). ` +
    `Si lo que va a crear la tarjeta difiere de la configuración estándar de pautas-meta, nombralo como desvío. Después llamá a propose_meta_ad: hipótesis, variable y predicción en "racional"; comparador, métrica, umbral y fecha de lectura en "medicion".\n` +
    `7. Si ninguna pieza pasa el filtro, o el cuello de botella no es la pauta, NO llames a propose_meta_ad: explicá en 2-3 líneas por qué. Es una respuesta válida.\n\n` +
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
      const historial = await historialParaAprender().catch(() => '');
      await runAgentTurn(cfg.conversationId, buildPrompt(cfg, usados, historial), undefined, abort.signal, {
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
