import cron from 'node-cron';
import { db } from '../db';
import { config } from '../config';
import { audit } from '../services/audit';
import { runAgentTurn } from '../agent/runner';
import { AD_EVALUATION_TOOL_LIST } from '../agent/tools';
import { runningConversations } from '../services/runningConversations';
import { TZ_RD, todayInRD } from '../util/fecha';
import { actualizarResultado, anunciosEnSeguimiento, DIAS_MINIMOS_EVALUACION, type ResultadoAnuncio } from '../services/resultadosAnuncios';

// ─────────────────────────────────────────────────────────────────────────
// El seguimiento diario de los anuncios de Kaizen (2026-10-05).
//
// Todos los días a las 7am RD:
//   1. Lee Meta y FinZen para cada anuncio creado que siga en su ventana, y
//      guarda el resultado (calculado en código). Esto no usa el modelo.
//   2. Si un anuncio llegó a 7 días con gasto y no tiene recomendación, corre
//      un turno de Kaizen EN LA CONVERSACIÓN DEL ANUNCIO para que lo evalúe:
//      el socio ve el análisis donde vio la propuesta. Las tools de esa
//      corrida (AD_EVALUATION_TOOL_LIST) leen y registran la recomendación;
//      no pueden proponer otro anuncio ni tocar FinZen.
//
// Nada de esto escribe en Meta. Pausar o seguir lo hace un humano.
// ─────────────────────────────────────────────────────────────────────────

let isRunning = false;

/** Cuántas veces se intenta la evaluación de un mismo anuncio antes de dejarlo para evaluar a mano. */
export const MAX_INTENTOS_EVALUACION = 3;

export interface AdResultsResult {
  leidos: number;
  fallidos: string[];
  evaluados: string[];
  omitidos: string[];
}

function buildPrompt(adId: string, nombre: string, r: ResultadoAnuncio): string {
  return (
    `<evento_sistema>Seguimiento automático (${todayInRD()}): el anuncio "${nombre}" (id ${adId}) que propusiste en esta conversación ya lleva ${r.diasConGasto} días con gasto. ` +
    `Es momento de evaluarlo.\n\n` +
    `1. get_meta_ad_results con ad_id=${adId} y refrescar=true.\n` +
    `2. Cargá el skill pautas-meta (el método de Junior: manda) y adquisicion-pagada §7 para los campos.\n` +
    `3. El umbral y el comparador están en el "medicion" de la tarjeta, fijados antes de gastar: NO los muevas. Si la tarjeta no los tiene, decilo y leé el resultado sin inventar un umbral.\n` +
    `4. Escribí en el chat 4-6 líneas: qué gastó y qué trajo (cifras tal cual, cada una con su confianza), en qué franja cae (gana, empate, pierde o "no se puede concluir"), la lección y la siguiente hipótesis. ` +
    `Nunca llames "registros" a los clics a descargar ni des un CAC por campaña.\n` +
    `5. record_meta_ad_evaluation con la acción que la ficha fijó para esa franja (seguir si gana, pausar si pierde, cambiar_post si el formato sirve y la pieza no) y la razón con esas cifras. Después, save_cerebro_note con resultado, veredicto, lección y siguiente hipótesis para el registro.\n\n` +
    `Recordá: no podés pausar ni editar la campaña. Si recomendás pausar o cambiar, el socio lo hace en Ads Manager.</evento_sistema>`
  );
}

export async function runAdResults(): Promise<AdResultsResult> {
  const out: AdResultsResult = { leidos: 0, fallidos: [], evaluados: [], omitidos: [] };
  if (isRunning) {
    out.omitidos.push('ya hay un seguimiento en curso');
    return out;
  }
  isRunning = true;
  const startedAt = Date.now();
  try {
    if (!config.meta.systemToken || !config.meta.adAccountId) {
      out.omitidos.push('Meta no está configurado');
      return out;
    }

    // 1. Leer y guardar. Un anuncio que falla no frena a los demás.
    const ads = await anunciosEnSeguimiento();
    const paraEvaluar: Array<{ id: string; nombre: string; conversationId: string; r: ResultadoAnuncio }> = [];
    for (const ad of ads) {
      try {
        const r = await actualizarResultado(ad);
        out.leidos++;
        if (r.evaluable && !ad.evaluadaEn) {
          if (ad.conversationId) paraEvaluar.push({ id: ad.id, nombre: ad.nombre, conversationId: ad.conversationId, r });
          else out.omitidos.push(`${ad.nombre}: listo para evaluar pero su conversación se borró`);
        }
      } catch (e) {
        out.fallidos.push(`${ad.nombre}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 2. Evaluar, de a uno y solo si la conversación está libre.
    if (paraEvaluar.length && !config.anthropicApiKey) {
      out.omitidos.push('hay anuncios para evaluar pero falta ANTHROPIC_API_KEY');
    } else {
      for (const a of paraEvaluar) {
        if (runningConversations.has(a.conversationId)) {
          out.omitidos.push(`${a.nombre}: la conversación estaba ocupada; se reintenta mañana`);
          continue;
        }
        // Tope de intentos (2026-10-10): si Kaizen corre y no registra la
        // recomendación, antes se reintentaba TODOS los días para siempre, y
        // cada intento es un turno completo del modelo. Se cuentan en el
        // audit log para no necesitar otra columna.
        const intentos = await db.auditLog.count({
          where: { action: 'ad-evaluation:attempt', input: { path: ['ad_proposal_id'], equals: a.id } },
        });
        if (intentos >= MAX_INTENTOS_EVALUACION) {
          out.omitidos.push(`${a.nombre}: ${intentos} intentos sin recomendación registrada; no se reintenta (evaluar a mano en el chat)`);
          continue;
        }
        await audit.log({ conversationId: a.conversationId, actor: 'cron', action: 'ad-evaluation:attempt', input: { ad_proposal_id: a.id, intento: intentos + 1 } });
        const abort = new AbortController();
        runningConversations.add(a.conversationId, abort);
        try {
          await runAgentTurn(a.conversationId, buildPrompt(a.id, a.nombre, a.r), undefined, abort.signal, {
            toolList: AD_EVALUATION_TOOL_LIST,
            // results ×3 + skill + Cerebro + record ≈ 6.
            maxIterations: 10,
          });
          const ya = await db.adProposal.findUnique({ where: { id: a.id }, select: { evaluadaEn: true } });
          if (ya?.evaluadaEn) out.evaluados.push(a.nombre);
          else out.omitidos.push(`${a.nombre}: Kaizen corrió pero no registró la recomendación; se reintenta mañana (hasta ${MAX_INTENTOS_EVALUACION} intentos)`);
        } catch (e) {
          out.fallidos.push(`${a.nombre} (evaluación): ${e instanceof Error ? e.message : e}`);
        } finally {
          runningConversations.delete(a.conversationId);
        }
      }
    }
    return out;
  } finally {
    isRunning = false;
    const resumen =
      `${out.leidos} leídos · ${out.evaluados.length} evaluados` +
      (out.evaluados.length ? ` (${out.evaluados.join(', ')})` : '') +
      (out.omitidos.length ? ` · omitidos: ${out.omitidos.join(' · ')}` : '') +
      (out.fallidos.length ? ` · fallidos: ${out.fallidos.join(' · ')}` : '');
    if (out.leidos || out.fallidos.length || out.evaluados.length || out.omitidos.length) {
      await audit
        .log({ conversationId: null, actor: 'cron', action: 'cron:ad-results', resultSummary: resumen.slice(0, 2000), isError: out.fallidos.length > 0, durationMs: Date.now() - startedAt })
        .catch(() => {});
    }
  }
}

export { DIAS_MINIMOS_EVALUACION };

/** Todos los días a las 7am RD. Solo agenda. */
export function startAdResultsCron(): void {
  cron.schedule('0 7 * * *', () => void runAdResults(), { timezone: TZ_RD });
  console.log('[ad-results] seguimiento de anuncios programado todos los días a las 07:00 hora RD.');
}
