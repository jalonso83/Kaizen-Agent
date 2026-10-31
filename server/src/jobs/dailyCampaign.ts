import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { db } from '../db';
import { config } from '../config';
import { audit } from '../services/audit';
import { runAgentTurn } from '../agent/runner';
import { motivoParaNoLlamar } from '../services/saldoAnthropic';
import { DAILY_CAMPAIGN_TOOL_LIST } from '../agent/tools';
import { listSegments } from '../clients/finzenApi';
import { runningConversations } from '../services/runningConversations';
import { TZ_RD, todayInRD } from '../util/fecha';
import { CONFIRMADO_AUTO, confirmarYCrearBorrador } from '../services/confirmarPropuesta';
import { expresionCron } from '../services/publicidad';
import { SEGMENTOS_VETADOS } from '../agent/tools/campaigns';

// ─────────────────────────────────────────────────────────────────────────
// La campaña diaria (2026-09-20).
//
// Una vez al día, a la hora que elija el socio, Kaizen propone UNA campaña
// en la conversación elegida —con la tarjeta de siempre, Confirmar/Rechazar—
// y con una AUDIENCIA DISTINTA cada día. Apagada por defecto; se enciende en
// Configuración.
//
// Tres decisiones que son candados de código y no instrucciones:
//
//   1. La ROTACIÓN la calcula este archivo: los segmentos permitidos hoy son
//      el catálogo en vivo menos los que una campaña diaria ya usó en los
//      últimos N días. La lista viaja en ctx.restricciones y propose_campaign
//      RECHAZA cualquier slug fuera de ella, diga lo que diga el modelo.
//   2. Las tools de esta corrida (DAILY_CAMPAIGN_TOOL_LIST) incluyen
//      propose_campaign pero NO create_campaign_draft ni las de metas: el cron
//      puede poner la tarjeta; el borrador en FinZen solo se crea en el turno
//      que dispara el botón, que es una corrida normal iniciada por un humano.
//   3. Corre en una conversación REAL del socio, así que los dos backstops de
//      propose_campaign (segment_count contra evaluate_segment, lectura del
//      Cerebro) aplican solos: la evidencia es el audit log de esa conversación.
//
// MODO DIRECTO (config.modo = 'directo'): después de la corrida, si quedó una
// tarjeta PROPOSED de esta corrida, ESTE código (no el modelo) la confirma
// como 'auto:daily-campaign' y dispara el turno que crea el borrador —el
// mismo servicio que usa el botón—. El borrador nace PENDING_APPROVAL en el
// panel de FinZen, donde un humano lo aprueba. Es una puerta menos que en
// modo tarjeta, elegida por un ADMIN en Configuración; Auditoría la marca.
//
// Si la conversación elegida está ocupada (el socio escribiendo justo en ese
// momento), la corrida se omite y se audita; no se encola. Mañana hay otra.
//
// PLAN DE MENSAJERÍA (2026-10-26): corre solo los días elegidos (2-3 por
// semana, lunes/miércoles/viernes por defecto) y never_activated no entra
// nunca entre los permitidos (SEGMENTOS_VETADOS, que propose_campaign
// también hace cumplir).
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_HOUR = 9;
/** Lunes, miércoles y viernes: el default del schema, si la fila no lo trae. */
export const DIAS_DEFAULT = [1, 3, 5];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** Un segmento con menos alcance que esto no vale una campaña diaria (el holdout dejaría nada que medir). */
const MINIMO_ALCANZABLE = 50;

let scheduledTask: ScheduledTask | null = null;
let isRunning = false;

export type DailyCampaignResult =
  | { ok: true; conversationId: string; permitidos: string[]; modo: string; borradorAutomatico: boolean }
  | { ok: false; omitido: string };

/** Crea la conversación destino a nombre de quien configuró, con un título que dice qué es. */
async function crearConversacionDestino(partnerId: string, titulo = 'Campañas diarias'): Promise<string> {
  const c = await db.conversation.create({ data: { partnerId, title: titulo } });
  return c.id;
}

/**
 * Los slugs que hoy se pueden proponer. Exportada para probarla sin BD ni
 * FinZen: recibe el catálogo y los slugs usados, devuelve el resto — y si la
 * rotación agotó el catálogo, lo devuelve entero en vez de bloquear la
 * corrida (con 11 segmentos y 7 días no pasa; con un catálogo chico sí).
 */
export function segmentosPermitidos(catalogo: string[], usadosRecientes: string[]): string[] {
  // Los vetados (never_activated, plan de mensajería 2026-10-26) no entran
  // nunca, ni cuando la rotación se agota y se reabre el catálogo.
  const elegibles = catalogo.filter((s) => !SEGMENTOS_VETADOS.has(s));
  const usados = new Set(usadosRecientes);
  const libres = elegibles.filter((s) => !usados.has(s));
  return libres.length > 0 ? libres : [...elegibles];
}

async function usadosEnDias(dias: number): Promise<string[]> {
  const desde = new Date(Date.now() - dias * 86_400_000);
  const filas = await db.proposal.findMany({
    where: { origen: 'diaria', createdAt: { gte: desde } },
    select: { payload: true },
  });
  const slugs: string[] = [];
  for (const f of filas) {
    const slug = (f.payload as { segment_slug?: unknown } | null)?.segment_slug;
    if (typeof slug === 'string') slugs.push(slug);
  }
  return slugs;
}

function buildPrompt(permitidos: string[], usados: string[], rotacionDias: number, modo: string): string {
  return (
    `<evento_sistema>Corrida automática de la CAMPAÑA DIARIA (${todayInRD()}). Tu tarea: proponer UNA campaña hoy, en esta conversación, con la tarjeta de siempre; el socio la confirma o rechaza con los botones.\n\n` +
    `AUDIENCIA DE HOY — la regla es que cada día se propone a un segmento distinto. Segmentos permitidos hoy: ${permitidos.join(', ')}. ` +
    (usados.length ? `Usados por campañas diarias en los últimos ${rotacionDias} días (NO los propongas; propose_campaign los rechaza): ${usados.join(', ')}.\n\n` : 'Todavía no hay campañas diarias previas.\n\n') +
    `Hacé esto, en orden:\n` +
    `1. search_cerebro("decisions log") y search_cerebro("estado actual"): ubicate antes de proponer, y descartá ideas ya cerradas ahí.\n` +
    `2. list_segments, y evaluate_segment de los 2-3 segmentos PERMITIDOS con más sentido según el skill campanas-retencion (cargalo). Los counts son push alcanzable y se solapan entre segmentos: no los sumes.\n` +
    `3. get_kpis de los últimos 7 días y get_campaign_results de los últimos 14, para el racional y para no repetir un mensaje que ya no funcionó. Cada campaña trae su "lectura" calculada: las no_medible_entrega y ventana_abierta NO cuentan como "no funcionó" ni como "funcionó". get_message_type_performance para elegir el tipo de mensaje.\n` +
    `4. Cargá copy-push y diseno-experimentos, y escribí en el chat 3-5 líneas: qué segmento elegiste y por qué HOY (con cifras de los tools), el Título y el Mensaje, el OBJETIVO (habito, uso_funcion, monetizacion, reactivacion o aviso) y qué se va a medir con la métrica de ese objetivo. Después llamá a propose_campaign — UNA sola tarjeta, con el count exacto que devolvió evaluate_segment y un holdout mayor que 0.\n` +
    `5. Si ningún segmento permitido tiene al menos ${MINIMO_ALCANZABLE} usuarios alcanzables, o los datos no muestran ninguna oportunidad clara, NO llames a propose_campaign: escribí en 2-3 líneas por qué hoy no hay campaña y qué mirarías mañana. Es una respuesta válida.\n\n` +
    (modo === 'directo'
      ? `Esta corrida está en MODO DIRECTO: la tarjeta que registres se va a confirmar automáticamente y el borrador se creará en FinZen, donde un humano lo aprueba en el panel. Sé más exigente, no menos: ante la duda, no propongas. `
      : '') +
    `NO llames a create_campaign_draft (no está disponible en esta corrida): el borrador se crea solo después de la confirmación. Si no hay meta vigente, decilo en una línea; no la propongas acá (propose_goal no está disponible), el socio la fija por chat.` +
    `</evento_sistema>`
  );
}

export async function runDailyCampaign(opts: { forzar?: boolean } = {}): Promise<DailyCampaignResult> {
  if (isRunning) return { ok: false, omitido: 'Ya hay una campaña diaria en curso.' };
  isRunning = true;
  const startedAt = Date.now();

  const omitir = async (motivo: string): Promise<DailyCampaignResult> => {
    console.warn(`[daily-campaign] omitida: ${motivo}`);
    await audit.log({ conversationId: null, actor: 'cron', action: 'cron:daily-campaign', resultSummary: `omitida: ${motivo}`, isError: false, durationMs: Date.now() - startedAt });
    return { ok: false, omitido: motivo };
  };

  try {
    if (!config.anthropicApiKey) return await omitir('sin ANTHROPIC_API_KEY');
    // Sin saldo, el turno falla seguro: el cron no lo intenta (la corrida manual sí).
    const sinSaldo = motivoParaNoLlamar();
    if (sinSaldo && !opts.forzar) return await omitir(sinSaldo);

    const cfg = await db.dailyCampaignConfig.findUnique({ where: { id: 1 } });
    if (!cfg) return { ok: false, omitido: 'la campaña diaria no está configurada' };
    // Apagada a propósito: no es un evento. Antes dejaba una fila en Auditoría
    // cada día, tapando las que importan.
    if (!cfg.enabled && !opts.forzar) return { ok: false, omitido: 'la campaña diaria está apagada' };
    // En modo directo no hace falta que el socio elija conversación: el job
    // crea (o recrea) una a nombre de quien configuró. En modo tarjeta la
    // conversación es la decisión del socio y sin ella no se corre.
    let conversationId = cfg.conversationId;
    const existe = conversationId ? await db.conversation.findUnique({ where: { id: conversationId }, select: { id: true } }) : null;
    if (!existe) {
      if (cfg.modo === 'directo' && cfg.updatedBy) {
        conversationId = await crearConversacionDestino(cfg.updatedBy, 'Campañas diarias (automático)');
        await db.dailyCampaignConfig.update({ where: { id: 1 }, data: { conversationId } });
      } else if (!conversationId) {
        return await omitir('no hay conversación destino configurada');
      } else {
        return await omitir(`la conversación destino ${conversationId} ya no existe (¿se borró?); elegí otra en Configuración`);
      }
    }
    if (runningConversations.has(conversationId!)) return await omitir('la conversación destino está ocupada en este momento');
    cfg.conversationId = conversationId!;

    // La rotación, en código.
    let catalogo: string[];
    try {
      catalogo = (await listSegments()).map((s) => s.slug);
    } catch (e) {
      return await omitir(`no se pudo leer el catálogo de segmentos de FinZen: ${e instanceof Error ? e.message : e}`);
    }
    const usados = await usadosEnDias(cfg.rotacionDias);
    const permitidos = segmentosPermitidos(catalogo, usados);

    const inicioCorrida = new Date();
    const abort = new AbortController();
    runningConversations.add(cfg.conversationId, abort);
    let turno;
    try {
      turno = await runAgentTurn(cfg.conversationId, buildPrompt(permitidos, usados, cfg.rotacionDias, cfg.modo), undefined, abort.signal, {
        toolList: DAILY_CAMPAIGN_TOOL_LIST,
        restricciones: { origen: 'diaria', segmentosPermitidos: permitidos },
        // Cerebro ×2 + list + evaluate ×3 + kpis + results + performance + skills ×3 + propose ≈ 13.
        maxIterations: 18,
      });
    } finally {
      runningConversations.delete(cfg.conversationId);
    }
    // El turno falló (saldo, API caída…): no se confirma nada y se registra
    // como error, no como "corrió".
    if (!turno.ok) {
      await audit.log({ conversationId: cfg.conversationId, actor: 'cron', action: 'cron:daily-campaign', resultSummary: `falló: ${turno.error ?? 'error desconocido'}`.slice(0, 2000), isError: true, durationMs: Date.now() - startedAt });
      return { ok: false, omitido: turno.error ?? 'el turno del modelo falló' };
    }

    // Modo directo: la tarjeta de ESTA corrida se confirma en código y se crea
    // el borrador. Solo una (propose_campaign deja SUPERSEDED las anteriores),
    // solo si sigue PROPOSED, solo si nació en esta corrida.
    let borradorAutomatico = false;
    if (cfg.modo === 'directo') {
      const tarjeta = await db.proposal.findFirst({
        where: { conversationId: cfg.conversationId, status: 'PROPOSED', origen: 'diaria', createdAt: { gte: inicioCorrida } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, conversationId: true },
      });
      if (tarjeta) {
        const turnoBorrador = await confirmarYCrearBorrador(tarjeta, {
          confirmedBy: CONFIRMADO_AUTO,
          actor: 'cron',
          motivo: `campaña diaria en modo directo, configurado por ${cfg.updatedBy ?? '?'}`,
        });
        // No alcanza con haber confirmado: el borrador lo crea un turno del modelo,
        // que puede fallar. Se mira el estado real de la propuesta.
        const final = await db.proposal.findUnique({ where: { id: tarjeta.id }, select: { status: true } });
        borradorAutomatico = final?.status === 'EXECUTED';
        if (!borradorAutomatico) {
          await audit.log({
            conversationId: cfg.conversationId,
            actor: 'cron',
            action: 'cron:daily-campaign',
            resultSummary: `modo directo: la propuesta ${tarjeta.id} quedó confirmada pero el borrador NO se creó en FinZen (estado ${final?.status ?? '?'}${turnoBorrador.ok ? '' : `, ${turnoBorrador.error}`}). Revisar en la conversación.`.slice(0, 2000),
            isError: true,
          });
        }
      }
    }

    await audit.log({
      conversationId: cfg.conversationId,
      actor: 'cron',
      action: 'cron:daily-campaign',
      resultSummary: `corrió en ${Date.now() - startedAt}ms · modo ${cfg.modo}${borradorAutomatico ? ' · borrador creado automáticamente' : ''} · permitidos: ${permitidos.join(', ')}${usados.length ? ` · excluidos: ${[...new Set(usados)].join(', ')}` : ''}`,
      isError: false,
      durationMs: Date.now() - startedAt,
    });
    console.log(`[daily-campaign] listo en ${Date.now() - startedAt}ms (conversación ${cfg.conversationId}, modo ${cfg.modo}).`);
    return { ok: true, conversationId: cfg.conversationId, permitidos, modo: cfg.modo, borradorAutomatico };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    await audit.log({ conversationId: null, actor: 'cron', action: 'cron:daily-campaign', resultSummary: motivo.slice(0, 2000), isError: true, durationMs: Date.now() - startedAt });
    return { ok: false, omitido: motivo };
  } finally {
    isRunning = false;
  }
}

/** Programa (o reprograma) según la config. No corre nada al llamarla. */
export async function startDailyCampaignCron(): Promise<void> {
  const cfg = await db.dailyCampaignConfig.findUnique({ where: { id: 1 } }).catch(() => null);
  const hour = cfg?.cronHour ?? DEFAULT_HOUR;
  if (scheduledTask) {
    await scheduledTask.destroy();
    scheduledTask = null;
  }
  // Se programa siempre, apagada o no: runDailyCampaign lee `enabled` en cada
  // disparo, así encender desde la web no necesita reprogramar nada. Los días
  // sí van en la expresión (2026-10-26, plan de mensajería: 2-3 por semana).
  const dias = cfg?.diasSemana?.length ? cfg.diasSemana : DIAS_DEFAULT;
  scheduledTask = cron.schedule(expresionCron(hour, dias), () => void runDailyCampaign(), { timezone: TZ_RD });
  console.log(
    `[daily-campaign] programada ${dias.map((d) => DIAS[d]).join(', ')} a las ${String(hour).padStart(2, '0')}:00 hora RD (${cfg?.enabled ? 'encendida' : 'apagada'}).`,
  );
}
