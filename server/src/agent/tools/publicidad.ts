import type { KaizenTool, ToolContext } from './guard';
import { verificarLecturaCerebro } from './campaigns';
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
