import type { AdProposal, MetaAdsConfig } from '@prisma/client';
import { db } from '../db';
import { config } from '../config';
import { audit } from './audit';
import { persistUserText } from '../agent/history';
import {
  assertBudget,
  crearAnuncioIgEnPausa,
  getAccount,
  MetaApiError,
  OBJETIVOS_ANUNCIO,
  urlAdsManager,
  type IdsAnuncio,
  type ObjetivoAnuncio,
} from '../clients/metaApi';
import type { PublicacionInstagram } from '../clients/instagramApi';
import { todayInRD } from '../util/fecha';

// ─────────────────────────────────────────────────────────────────────────
// La publicidad automática en Meta (2026-10-04).
//
// Los días y a la hora configurados, Kaizen elige un post de Instagram de
// FinZen que rindió bien y propone promocionarlo, con una tarjeta. Al
// confirmar, ESTE código —no el modelo— crea campaña, conjunto, creativo y
// anuncio en Meta, todo EN PAUSA. Un humano la activa en Ads Manager.
//
// Lo que es candado de código y no instrucción:
//   1. El presupuesto, la duración, el objetivo, el destino y la segmentación
//      salen de MetaAdsConfig en el momento de proponer. La tool no tiene
//      dónde recibirlos.
//   2. El post se verifica contra las publicaciones REALES de la cuenta propia
//      de FinZen. Un id inventado o de un competidor no pasa.
//   3. El mismo post no se promociona dos veces dentro de rotacionDias.
//   4. META_MAX_DAILY_BUDGET_USD y META_WRITE_ENABLED siguen mandando (en
//      metaApi.ts): la configuración no puede superarlos.
//   5. La transición PROPOSED → CONFIRMED la escribe solo el endpoint HTTP,
//      con permiso publicidad:confirmar. Una tarjeta vieja (CADUCIDAD_HORAS)
//      ya no se puede confirmar: los datos con los que se propuso envejecieron.
// ─────────────────────────────────────────────────────────────────────────

export const CADUCIDAD_HORAS = 72;
export const DURACION_MAXIMA_DIAS = 30;

export type OrigenAnuncio = 'chat' | 'programada';

export interface Segmentacion {
  paises: string[];
  edadMin: number;
  edadMax: number;
  categoriaFinanciera: boolean;
}

// ── Utilidades puras (probadas sin BD ni Meta) ────────────────────────────

/** "Ahorro en 3 pasos!!" → "ahorro-en-3-pasos". Corto: va en el nombre y en el UTM. */
export function slugCorto(texto: string): string {
  const s = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return s || 'post';
}

/** kaizen-ig-20261004-ahorro-en-3-pasos. Es también el utm_campaign. */
export function nombreCampana(fechaRD: string, slug: string): string {
  return `kaizen-ig-${fechaRD.replace(/-/g, '')}-${slugCorto(slug)}`;
}

/**
 * Le pone los UTM a la URL de destino. utm_campaign = nombre de la campaña en
 * Meta: así el gasto (get_meta_spend) y la adquisición de FinZen (by_source)
 * unen por nombre sin depender de que alguien los escriba igual a mano — el
 * problema que CRUCE_NOTE describe para las campañas creadas por humanos.
 */
export function urlConUtm(url: string, nombre: string): string {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'meta');
  u.searchParams.set('utm_medium', 'paid_social');
  u.searchParams.set('utm_campaign', nombre);
  return u.toString();
}

/** La segmentación efectiva: con categoría financiera, Meta exige 18-65. */
export function segmentacionEfectiva(cfg: Pick<MetaAdsConfig, 'paises' | 'edadMin' | 'edadMax' | 'categoriaFinanciera'>): Segmentacion {
  return cfg.categoriaFinanciera
    ? { paises: cfg.paises, edadMin: 18, edadMax: 65, categoriaFinanciera: true }
    : { paises: cfg.paises, edadMin: cfg.edadMin, edadMax: cfg.edadMax, categoriaFinanciera: false };
}

/**
 * Valida el cuerpo de PUT /config/meta-ads. Devuelve el mensaje de error o
 * null. Exportada para probarla: es la primera barrera del presupuesto.
 */
export function validarConfigPublicidad(b: Record<string, unknown>, topeDiario = config.meta.maxDailyBudgetUsd): string | null {
  if (typeof b.enabled !== 'boolean') return '"enabled" debe ser true o false.';
  const dias = b.diasSemana;
  if (!Array.isArray(dias) || dias.length === 0 || dias.some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) {
    return '"diasSemana" debe ser una lista no vacía de días 0-6 (0 = domingo).';
  }
  if (!Number.isInteger(b.cronHour) || (b.cronHour as number) < 0 || (b.cronHour as number) > 23) return '"cronHour" debe ser una hora entera de 0 a 23 (hora de RD).';
  const p = b.presupuestoDiario;
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return '"presupuestoDiario" debe ser un número mayor que cero.';
  if (p > topeDiario) return `El presupuesto diario (${p}) supera el tope de ${topeDiario} USD (META_MAX_DAILY_BUDGET_USD). El tope se cambia en Railway, no desde acá.`;
  if (!Number.isInteger(b.duracionDias) || (b.duracionDias as number) < 1 || (b.duracionDias as number) > DURACION_MAXIMA_DIAS) {
    return `"duracionDias" debe ser un entero de 1 a ${DURACION_MAXIMA_DIAS}.`;
  }
  if (!(OBJETIVOS_ANUNCIO as readonly string[]).includes(b.objetivo as string)) return `"objetivo" debe ser uno de: ${OBJETIVOS_ANUNCIO.join(', ')}.`;
  if (b.urlDestino != null && b.urlDestino !== '') {
    try {
      const u = new URL(String(b.urlDestino));
      if (u.protocol !== 'https:') return 'La URL de destino tiene que ser https.';
    } catch {
      return 'La URL de destino no es válida.';
    }
  }
  if (b.objetivo === 'OUTCOME_TRAFFIC' && !b.urlDestino) return 'Con el objetivo de tráfico hace falta la URL de destino (la landing de FinZen).';
  const paises = b.paises;
  if (!Array.isArray(paises) || paises.length === 0 || paises.some((x) => typeof x !== 'string' || !/^[A-Z]{2}$/.test(x))) {
    return '"paises" debe ser una lista de códigos ISO de 2 letras en mayúsculas (ej. DO).';
  }
  if (!Number.isInteger(b.edadMin) || !Number.isInteger(b.edadMax) || (b.edadMin as number) < 18 || (b.edadMax as number) > 65 || (b.edadMin as number) > (b.edadMax as number)) {
    return 'La edad va de 18 a 65, y la mínima no puede ser mayor que la máxima.';
  }
  if (typeof b.categoriaFinanciera !== 'boolean') return '"categoriaFinanciera" debe ser true o false.';
  if (!Number.isInteger(b.rotacionDias) || (b.rotacionDias as number) < 1 || (b.rotacionDias as number) > 365) return '"rotacionDias" debe ser un entero de 1 a 365.';
  return null;
}

/** "0 9 * * 1,4": la expresión cron de los días elegidos. */
export function expresionCron(cronHour: number, diasSemana: number[]): string {
  const dias = [...new Set(diasSemana)].sort((a, b) => a - b);
  return `0 ${cronHour} * * ${dias.join(',')}`;
}

/**
 * Verifica que el post sea de FinZen y que no se haya promocionado hace
 * poco. Devuelve la publicación o lanza un error redactado para el modelo.
 */
export function verificarPost(mediaId: string, publicaciones: PublicacionInstagram[], usadosRecientes: string[], rotacionDias: number): PublicacionInstagram {
  const pub = publicaciones.find((p) => p.id === mediaId);
  if (!pub) {
    throw new Error(
      `El post "${mediaId}" no está entre las publicaciones recientes de la cuenta de Instagram de FinZen. ` +
        'Solo se puede promocionar un post propio: usa el `id` exacto de un elemento de `publicaciones` que devolvió get_instagram_profile sobre la cuenta de FinZen.',
    );
  }
  if (usadosRecientes.includes(mediaId)) {
    throw new Error(
      `Ese post ya se propuso o promocionó en los últimos ${rotacionDias} días. Elige otro: la regla es no repetir el mismo post dentro de esa ventana.`,
    );
  }
  return pub;
}

export function vencida(createdAt: Date, ahora = new Date()): boolean {
  return ahora.getTime() - createdAt.getTime() > CADUCIDAD_HORAS * 3_600_000;
}

// ── Con BD ────────────────────────────────────────────────────────────────

export async function leerConfigPublicidad(): Promise<MetaAdsConfig | null> {
  return db.metaAdsConfig.findUnique({ where: { id: 1 } });
}

/** Posts propuestos o promocionados en la ventana de rotación (los rechazados no cuentan). */
export async function postsUsados(dias: number): Promise<string[]> {
  const filas = await db.adProposal.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - dias * 86_400_000) },
      status: { in: ['PROPOSED', 'CONFIRMED', 'CREATING', 'CREATED_PAUSED', 'ERROR'] },
    },
    select: { mediaId: true },
  });
  return [...new Set(filas.map((f) => f.mediaId))];
}

/** Lo que falta para poder crear, en una frase. null si está todo. */
export function faltaParaCrear(): string | null {
  const faltan: string[] = [];
  if (!config.meta.systemToken) faltan.push('META_SYSTEM_TOKEN');
  if (!config.meta.adAccountId) faltan.push('META_AD_ACCOUNT_ID');
  if (!config.meta.pageId) faltan.push('META_PAGE_ID');
  if (!config.instagram.accountId) faltan.push('INSTAGRAM_ACCOUNT_ID');
  if (faltan.length) return `faltan variables en Railway: ${faltan.join(', ')}`;
  if (!config.meta.writeEnabled) return 'la escritura en Meta está apagada (META_WRITE_ENABLED=false); se enciende cuando el token tenga ads_management';
  return null;
}

export interface NuevaPropuestaAnuncio {
  conversationId: string;
  origen: OrigenAnuncio;
  publicacion: PublicacionInstagram;
  slug: string;
  racional: string;
  medicion: string;
  cfg: MetaAdsConfig;
}

/** Registra la tarjeta. Reemplaza las PROPOSED anteriores de la conversación. */
export async function registrarPropuestaAnuncio(n: NuevaPropuestaAnuncio): Promise<AdProposal> {
  const nombre = nombreCampana(todayInRD(), n.slug);
  const seg = segmentacionEfectiva(n.cfg);
  const urlDestino = n.cfg.objetivo === 'OUTCOME_TRAFFIC' && n.cfg.urlDestino ? urlConUtm(n.cfg.urlDestino, nombre) : null;

  return db.$transaction(async (tx) => {
    await tx.adProposal.updateMany({ where: { conversationId: n.conversationId, status: 'PROPOSED' }, data: { status: 'SUPERSEDED' } });
    return tx.adProposal.create({
      data: {
        conversationId: n.conversationId,
        origen: n.origen,
        mediaId: n.publicacion.id,
        mediaPermalink: n.publicacion.permalink,
        mediaTipo: n.publicacion.media_product_type ?? n.publicacion.media_type,
        mediaCaption: n.publicacion.caption ? n.publicacion.caption.slice(0, 200) : null,
        nombre,
        objetivo: n.cfg.objetivo,
        urlDestino,
        presupuestoDiario: n.cfg.presupuestoDiario,
        duracionDias: n.cfg.duracionDias,
        segmentacion: seg as object,
        racional: n.racional,
        medicion: n.medicion,
      },
    });
  });
}

export type ResultadoCreacion =
  | { ok: true; propuesta: AdProposal; adsManager: string }
  | { ok: false; propuesta: AdProposal; error: string };

/**
 * PROPOSED → CONFIRMED → CREATING → CREATED_PAUSED | ERROR. Quien llama ya
 * verificó permiso, pertenencia, estado PROPOSED y que no esté vencida.
 */
export async function confirmarYCrearAnuncio(p: AdProposal, partnerId: string): Promise<ResultadoCreacion> {
  // La transición, condicionada al estado: dos clics simultáneos no crean dos campañas.
  const tomada = await db.adProposal.updateMany({
    where: { id: p.id, status: 'PROPOSED' },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: partnerId },
  });
  if (tomada.count === 0) {
    const actual = await db.adProposal.findUniqueOrThrow({ where: { id: p.id } });
    return { ok: false, propuesta: actual, error: `La tarjeta ya no está pendiente (estado: ${actual.status}).` };
  }
  await audit.log({ conversationId: p.conversationId, actor: `partner:${partnerId}`, action: 'ad-proposal:confirmed', input: { ad_proposal_id: p.id, nombre: p.nombre } });

  const seg = p.segmentacion as unknown as Segmentacion;
  const inicio = new Date();
  const fin = new Date(inicio.getTime() + p.duracionDias * 86_400_000);
  await db.adProposal.update({ where: { id: p.id }, data: { status: 'CREATING', inicio, fin } });

  const guardarIds = async (ids: IdsAnuncio) => {
    await db.adProposal.update({
      where: { id: p.id },
      data: { metaCampaignId: ids.campaignId, metaAdSetId: ids.adSetId, metaCreativeId: ids.creativeId, metaAdId: ids.adId },
    });
  };

  try {
    const ids = await crearAnuncioIgEnPausa(
      {
        nombre: p.nombre,
        objetivo: p.objetivo as ObjetivoAnuncio,
        presupuestoDiarioUsd: p.presupuestoDiario,
        inicio,
        fin,
        paises: seg.paises,
        edadMin: seg.edadMin,
        edadMax: seg.edadMax,
        categoriaFinanciera: seg.categoriaFinanciera,
        mediaId: p.mediaId,
        urlDestino: p.urlDestino,
      },
      guardarIds,
    );
    const lista = await db.adProposal.update({ where: { id: p.id }, data: { status: 'CREATED_PAUSED', error: null } });
    const link = urlAdsManager(ids.campaignId);
    await audit.log({
      conversationId: p.conversationId,
      actor: `partner:${partnerId}`,
      action: 'ad-proposal:created-paused',
      input: { ad_proposal_id: p.id, ...ids },
      resultSummary: `${p.nombre} creada EN PAUSA · ${p.presupuestoDiario} ${p.moneda}/día · ${p.duracionDias} días`,
    });
    if (p.conversationId) {
      await persistUserText(
        p.conversationId,
        `<evento_sistema>El socio confirmó la tarjeta de anuncio ${p.id} y el sistema creó la campaña "${p.nombre}" en Meta, EN PAUSA (campaña ${ids.campaignId}). ` +
          'No gasta hasta que un humano la active en Ads Manager; tú no puedes activarla. Si el socio pregunta, dile que la active desde Ads Manager.</evento_sistema>',
      );
    }
    return { ok: true, propuesta: lista, adsManager: link };
  } catch (e) {
    const msg = e instanceof MetaApiError || e instanceof Error ? e.message : String(e);
    const conIds = await db.adProposal.findUniqueOrThrow({ where: { id: p.id } });
    const creados = [conIds.metaCampaignId && `campaña ${conIds.metaCampaignId}`, conIds.metaAdSetId && `conjunto ${conIds.metaAdSetId}`, conIds.metaCreativeId && `creativo ${conIds.metaCreativeId}`]
      .filter(Boolean)
      .join(', ');
    const error = creados ? `${msg} — Quedaron creados EN PAUSA (no gastan, pero hay que borrarlos en Ads Manager): ${creados}.` : msg;
    const fallida = await db.adProposal.update({ where: { id: p.id }, data: { status: 'ERROR', error: error.slice(0, 2000) } });
    await audit.log({ conversationId: p.conversationId, actor: `partner:${partnerId}`, action: 'ad-proposal:error', input: { ad_proposal_id: p.id }, resultSummary: error.slice(0, 2000), isError: true });
    if (p.conversationId) {
      await persistUserText(
        p.conversationId,
        `<evento_sistema>El socio confirmó la tarjeta de anuncio ${p.id}, pero Meta rechazó la creación: ${error.slice(0, 600)} No reintentes por tu cuenta; explícale al socio qué pasó.</evento_sistema>`,
      );
    }
    return { ok: false, propuesta: fallida, error };
  }
}

/** Para avisar en la tarjeta antes de confirmar: la moneda real de la cuenta y si el tope deja pasar. */
export async function chequeoPrevio(presupuesto: number): Promise<string | null> {
  const falta = faltaParaCrear();
  if (falta) return falta;
  try {
    const cuenta = await getAccount();
    assertBudget(presupuesto, cuenta.currency);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
