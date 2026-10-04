import type { AdProposal } from '@prisma/client';
import type { KaizenTool, ToolContext } from './guard';
import { verificarLecturaCerebro } from './campaigns';
import { db } from '../../db';
import { actualizarResultado, DIAS_MINIMOS_EVALUACION, type ResultadoAnuncio } from '../../services/resultadosAnuncios';
import { analizarPerfil, cuentasGuardadas, PUBLICACIONES_MAXIMO } from '../../services/instagramAnalisis';
import {
  faltaParaCrear,
  leerConfigPublicidad,
  postsUsados,
  registrarPropuestaAnuncio,
  segmentacionEfectiva,
  verificarPost,
} from '../../services/publicidad';

// ─────────────────────────────────────────────────────────────────────────
// propose_meta_ad (2026-10-04) — la tarjeta de un anuncio en Meta.
//
// Mismo patrón que propose_campaign: la tool solo escribe en NUESTRA BD. Lo
// que llega a Meta lo crea el endpoint del botón (routes/adProposals.ts), en
// pausa. Y lo que más importa es lo que esta tool NO recibe: presupuesto,
// duración, objetivo, URL ni segmentación. Salen de la configuración que
// fijó un admin; el modelo no tiene dónde escribir "gastá 500".
// ─────────────────────────────────────────────────────────────────────────

export const proposeMetaAdTool: KaizenTool = {
  name: 'propose_meta_ad',
  ambito: 'marketing',
  description:
    'Propone PROMOCIONAR en Meta Ads un post de Instagram de FinZen que ya está publicado. Registra una tarjeta; el socio la confirma o rechaza con los botones, ' +
    'y recién al confirmar el sistema crea la campaña EN PAUSA (un humano la activa en Ads Manager — tú nunca puedes activarla). ' +
    'Presupuesto diario, duración, objetivo, URL de destino y segmentación NO los eliges tú: salen de Configuración → Publicidad automática, y la tarjeta los muestra. ' +
    'Antes de llamarla: get_instagram_profile sobre la cuenta de FinZen (para elegir con datos y tener el id del post), el skill adquisicion-pagada, y search_cerebro. ' +
    'El media_id se verifica contra las publicaciones reales de la cuenta de FinZen, y un post ya promocionado en la ventana de rotación se rechaza.',
  inputSchema: {
    type: 'object',
    properties: {
      media_id: { type: 'string', description: 'El `id` EXACTO de un elemento de `publicaciones` de get_instagram_profile sobre la cuenta de FinZen' },
      nombre_corto: { type: 'string', description: '2-5 palabras sobre el tema del post (ej. "gastos hormiga"). Se usa en el nombre de la campaña y en el utm_campaign' },
      racional: { type: 'string', description: 'Por qué ESTE post y por qué ahora, con cifras de get_instagram_profile (interacciones vs la mediana de la cuenta, tipo, fecha). ≥ 30 caracteres' },
      medicion: { type: 'string', description: 'Qué se va a mirar y cuándo (ej. CTR y CPC a los 7 días, registros con este utm_campaign en get_kpis). Recuerda: <7 días no se evalúa' },
    },
    required: ['media_id', 'nombre_corto', 'racional', 'medicion'],
  },
  async execute(input, ctx: ToolContext) {
    if (!ctx.conversationId) throw new Error('propose_meta_ad requiere una conversación activa.');
    const mediaId = String(input.media_id ?? '').trim();
    const nombreCorto = String(input.nombre_corto ?? '').trim();
    const racional = String(input.racional ?? '').trim();
    const medicion = String(input.medicion ?? '').trim();
    if (!mediaId) throw new Error('Falta "media_id".');
    if (!nombreCorto) throw new Error('Falta "nombre_corto".');
    if (racional.length < 30) throw new Error('El racional es demasiado corto: explica con cifras por qué este post (≥30 caracteres).');
    if (medicion.length < 10) throw new Error('Falta decir qué se va a medir y cuándo.');

    const cfg = await leerConfigPublicidad();
    if (!cfg) {
      throw new Error(
        'La publicidad automática no está configurada (presupuesto, duración, destino). NO reintentes: dile al socio que un admin la configure en Configuración → Publicidad automática.',
      );
    }
    const falta = faltaParaCrear();
    if (falta) {
      throw new Error(`No se puede proponer un anuncio todavía: ${falta}. NO reintentes; díselo al socio tal cual.`);
    }

    // Regla 9: antes de proponer, el Cerebro (decisiones cerradas, estado actual).
    await verificarLecturaCerebro(ctx.conversationId);

    const propia = (await cuentasGuardadas()).find((c) => c.esPropia);
    if (!propia) {
      throw new Error('No hay una cuenta de Instagram de FinZen marcada como propia en Marketing → Configuración. Sin eso no hay qué promocionar; díselo al socio.');
    }
    const analisis = await analizarPerfil(propia, { publicaciones: PUBLICACIONES_MAXIMO });
    const usados = await postsUsados(cfg.rotacionDias);
    const publicacion = verificarPost(mediaId, analisis.publicaciones, usados, cfg.rotacionDias);

    const propuesta = await registrarPropuestaAnuncio({
      conversationId: ctx.conversationId,
      origen: ctx.restricciones?.origen === 'publicidad' ? 'programada' : 'chat',
      publicacion,
      slug: nombreCorto,
      racional,
      medicion,
      cfg,
    });
    ctx.sse?.send('ad_proposal', propuesta);

    const seg = segmentacionEfectiva(cfg);
    return (
      `Tarjeta de anuncio registrada (id ${propuesta.id}): "${propuesta.nombre}", ${cfg.presupuestoDiario} USD/día durante ${cfg.duracionDias} días ` +
      `(tope total ${cfg.presupuestoDiario * cfg.duracionDias} USD), ${cfg.objetivo}, ${seg.paises.join('/')} ${seg.edadMin}-${seg.edadMax}. ` +
      'El socio la confirma o rechaza en la tarjeta. Al confirmar, el sistema la crea EN PAUSA; no prometas que va a estar corriendo.'
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Seguimiento (2026-10-05): leer cómo rindieron los anuncios de Kaizen y
// dejar la recomendación. Ninguna de las dos escribe en Meta: pausar o
// seguir lo hace un humano en Ads Manager.
// ─────────────────────────────────────────────────────────────────────────

const RESULTADOS_NOTE =
  'CÓMO LEER ESTO (método en el skill adquisicion-pagada §8): todo viene calculado en código; úsalo tal cual, no recalcules. ' +
  'Con menos de 7 días con gasto (`evaluable: false`) NO se evalúa, ni para bien ni para mal: dilo así. ' +
  '`finzen.clicsDescarga` son clics ÚNICOS al botón "Descargar" de visitantes con este utm_campaign, NO registros ni suscripciones; nunca los llames registros. ' +
  '`alcance` es el máximo diario (un piso), no la suma. `estadoMeta` es el estado real en Meta: si dice PAUSED y `diasConGasto` es 0, nadie la activó todavía.';

function vista(a: AdProposal) {
  return {
    id: a.id,
    nombre: a.nombre,
    post: a.mediaPermalink,
    tipo: a.mediaTipo,
    objetivo: a.objetivo,
    presupuesto_diario: a.presupuestoDiario,
    moneda: a.moneda,
    duracion_dias: a.duracionDias,
    creada: a.inicio,
    fin: a.fin,
    resultado: a.resultado ?? null,
    resultado_leido_en: a.resultadoEn,
    recomendacion: a.recomendacion ? { valor: a.recomendacion, razon: a.recomendacionRazon, en: a.evaluadaEn } : null,
  };
}

export const getMetaAdResultsTool: KaizenTool = {
  name: 'get_meta_ad_results',
  ambito: 'marketing',
  description:
    'Resultados de los anuncios que Kaizen propuso y se crearon en Meta: estado real, días con gasto, gasto, impresiones, clics al enlace, CTR, costo por clic, ' +
    'y de FinZen los visitantes y clics únicos a descargar con ese utm_campaign (el nombre de la campaña). Todo calculado en código. ' +
    'Sin ad_id lista los últimos con la última lectura guardada; con ad_id y refrescar=true lee Meta y FinZen en vivo. ' +
    'Úsala antes de opinar sobre un anuncio de Kaizen y antes de proponer el próximo, para no repetir lo que no funcionó.',
  inputSchema: {
    type: 'object',
    properties: {
      ad_id: { type: 'string', description: 'id de la tarjeta de anuncio (opcional)' },
      refrescar: { type: 'boolean', description: 'Con ad_id: leer en vivo en vez de la última lectura guardada' },
    },
  },
  async execute(input) {
    const adId = typeof input.ad_id === 'string' ? input.ad_id.trim() : '';
    if (adId) {
      let ad = await db.adProposal.findUnique({ where: { id: adId } });
      if (!ad) throw new Error(`No existe la tarjeta de anuncio "${adId}". Llama sin ad_id para ver la lista.`);
      if (ad.status !== 'CREATED_PAUSED') {
        return `Ese anuncio no llegó a crearse en Meta (estado de la tarjeta: ${ad.status}), así que no tiene resultados.`;
      }
      if (input.refrescar === true) {
        try {
          await actualizarResultado(ad);
        } catch (e) {
          throw new Error(`No pude leer los resultados en vivo: ${e instanceof Error ? e.message : e}. Usa la última lectura guardada (sin refrescar) y dilo.`);
        }
        ad = await db.adProposal.findUniqueOrThrow({ where: { id: adId } });
      }
      return [RESULTADOS_NOTE, JSON.stringify(vista(ad))].join('\n');
    }
    const ads = await db.adProposal.findMany({ where: { status: 'CREATED_PAUSED' }, orderBy: { createdAt: 'desc' }, take: 10 });
    if (ads.length === 0) return 'Todavía no hay anuncios de Kaizen creados en Meta. No hay resultados que leer.';
    return [RESULTADOS_NOTE, JSON.stringify({ anuncios: ads.map(vista) })].join('\n');
  },
};

export const RECOMENDACIONES = ['seguir', 'pausar', 'cambiar_post'] as const;
/** Una lectura más vieja que esto no sirve para evaluar: se pide refrescar. */
export const FRESCURA_HORAS = 48;

/**
 * Los candados de la evaluación, puros para probarlos: devuelve el error
 * redactado para el modelo, o null si se puede registrar.
 */
export function motivoParaNoEvaluar(
  ad: Pick<AdProposal, 'status' | 'evaluadaEn' | 'recomendacion' | 'resultado' | 'resultadoEn'> | null,
  ahora = new Date(),
): string | null {
  if (!ad || ad.status !== 'CREATED_PAUSED') return 'No hay un anuncio creado en Meta con ese id.';
  if (ad.evaluadaEn) {
    return `Ese anuncio ya tiene una recomendación (${ad.recomendacion}, del ${ad.evaluadaEn.toISOString().slice(0, 10)}). No se sobrescribe: si cambió algo, dilo en el chat.`;
  }
  const r = ad.resultado as unknown as ResultadoAnuncio | null;
  if (!r || !ad.resultadoEn) return 'Ese anuncio no tiene resultados leídos. Llama a get_meta_ad_results con ad_id y refrescar=true primero.';
  if (ahora.getTime() - ad.resultadoEn.getTime() > FRESCURA_HORAS * 3_600_000) {
    return `La última lectura tiene más de ${FRESCURA_HORAS} horas. Refresca con get_meta_ad_results (ad_id, refrescar=true) antes de recomendar.`;
  }
  // La regla de los 7 días, como candado: no se evalúa durante el aprendizaje de Meta.
  if (!r.evaluable) {
    return `Todavía no se puede evaluar: lleva ${r.diasConGasto} día(s) con gasto y hacen falta ${DIAS_MINIMOS_EVALUACION}. Dile al socio cuándo se va a poder, sin adelantar un veredicto.`;
  }
  return null;
}

export const recordMetaAdEvaluationTool: KaizenTool = {
  name: 'record_meta_ad_evaluation',
  ambito: 'marketing',
  description:
    'Registra TU recomendación sobre un anuncio de Kaizen con al menos 7 días con gasto: "seguir" (rinde, que siga hasta su fin), "pausar" (no rinde, frenarlo) ' +
    'o "cambiar_post" (el formato sirve pero esta pieza no: probar con otra). La tarjeta del anuncio la muestra. NO pausa ni cambia nada en Meta: eso lo hace un humano en Ads Manager. ' +
    'Antes: get_meta_ad_results con ad_id y refrescar=true, y el skill adquisicion-pagada §8. La razón lleva las cifras de esa lectura.',
  inputSchema: {
    type: 'object',
    properties: {
      ad_id: { type: 'string', description: 'id de la tarjeta de anuncio' },
      recomendacion: { type: 'string', enum: [...RECOMENDACIONES] },
      razon: {
        type: 'string',
        description: 'Por qué, con las cifras de la lectura (CTR, costo por clic, costo por clic a descargar) y contra qué las comparas. ≥ 40 caracteres',
      },
    },
    required: ['ad_id', 'recomendacion', 'razon'],
  },
  async execute(input, ctx: ToolContext) {
    const adId = String(input.ad_id ?? '').trim();
    const rec = String(input.recomendacion ?? '');
    const razon = String(input.razon ?? '').trim();
    if (!(RECOMENDACIONES as readonly string[]).includes(rec)) throw new Error(`"recomendacion" debe ser una de: ${RECOMENDACIONES.join(', ')}.`);
    if (razon.length < 40) throw new Error('La razón es demasiado corta: pon las cifras de la lectura y contra qué las comparas.');

    const ad = await db.adProposal.findUnique({ where: { id: adId } });
    const motivo = motivoParaNoEvaluar(ad);
    if (motivo) throw new Error(motivo);

    const actualizado = await db.adProposal.update({
      where: { id: adId },
      data: { recomendacion: rec, recomendacionRazon: razon, evaluadaEn: new Date() },
    });
    ctx.sse?.send('ad_proposal', actualizado);
    return (
      `Recomendación registrada (${rec}). La tarjeta del anuncio la muestra. ` +
      (rec === 'seguir'
        ? 'No hace falta que el socio haga nada.'
        : 'Recuérdale al socio que el cambio lo hace él en Ads Manager: tú no puedes pausar ni editar la campaña.')
    );
  },
};
