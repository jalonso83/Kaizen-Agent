import { Prisma } from '@prisma/client';
import { db } from '../db';
import {
  getInsightsPropios,
  getPerfil,
  instagramConfigurado,
  type InsightsPropios,
  type PublicacionInstagram,
} from '../clients/instagramApi';

// ─────────────────────────────────────────────────────────────────────────
// Análisis de un perfil de Instagram — lo que comparten la tool del agente
// (get_instagram_profile) y el Dashboard de Marketing (routes/marketing.ts).
//
// Una sola definición de "qué se mira de una cuenta" a propósito: si el
// dashboard mostrara una tasa de engagement calculada de una forma y Kaizen
// la contara de otra, el socio vería dos números distintos para lo mismo y
// no sabría cuál creer. Acá se calcula una vez; los dos lo muestran.
//
// Qué se considera importante para una cuenta de empresa, y de dónde sale:
//
//   Perfil (business_discovery, cualquier cuenta profesional pública)
//     seguidores, seguidos, publicaciones totales, y las últimas N piezas con
//     likes y comentarios.
//   Calculado acá, a partir de esas piezas
//     interacciones (likes + comentarios), promedios y MEDIANA por pieza, tasa
//     de engagement, ritmo de publicación, mezcla por tipo, top 3.
//   Insights (solo la cuenta propia, permiso instagram_manage_insights)
//     alcance, views, cuentas que interactuaron, guardados, compartidos, taps
//     al link, altas/bajas de seguidores, y seguidores nuevos por día.
//
// Sobre la tasa de engagement: se usa la definición más común para comparar
// cuentas —interacciones promedio por pieza / seguidores × 100— y se dice
// cuál es. Hay otras (sobre alcance, sobre views); si se agrega otra, se
// nombra distinto, no se cambia esta en silencio.
// ─────────────────────────────────────────────────────────────────────────

export interface CuentaGuardada {
  usuario: string;
  url: string;
  etiqueta: string | null;
  esPropia: boolean;
}

export interface ResumenPublicaciones {
  cantidad: number;
  /** Promedios sobre las publicaciones leídas, redondeados a 1 decimal. */
  likes_promedio: number;
  comentarios_promedio: number;
  interacciones_promedio: number;
  /** Mediana de likes: con una pieza viral el promedio miente. */
  likes_mediana: number;
  likes_total: number;
  comentarios_total: number;
  interacciones_total: number;
  /** Conteo e interacciones promedio por tipo (REELS, FEED, ...). */
  por_tipo: Array<{ tipo: string; cantidad: number; likes_promedio: number; interacciones_promedio: number }>;
  /** Las 3 con más interacciones, para "qué llamó más la atención". */
  top: Array<{ permalink: string; likes: number; comentarios: number; interacciones: number; tipo: string; fecha: string; caption_inicio: string }>;
  /** Fecha de la más vieja y la más nueva leídas: es la ventana real del resumen. */
  desde: string | null;
  hasta: string | null;
  /** Piezas por semana dentro de esa ventana. Null si hay menos de 2 piezas. */
  piezas_por_semana: number | null;
}

export interface AnalisisInstagram {
  cuenta: { usuario: string; url: string; etiqueta: string | null; es_de_finzen: boolean };
  perfil: {
    nombre: string;
    biografia: string;
    sitio_web: string | null;
    seguidores: number;
    seguidos: number;
    publicaciones_totales: number;
    /** seguidores / seguidos, redondeado. Null si no sigue a nadie. */
    ratio_seguidores_seguidos: number | null;
  };
  /**
   * interacciones_promedio / seguidores × 100, con 2 decimales. Null si la
   * cuenta no tiene seguidores o no hay piezas. Es la definición "por pieza
   * sobre seguidores"; el nombre del campo lo dice para que nadie la confunda
   * con una tasa sobre alcance.
   */
  tasa_engagement_pct: number | null;
  resumen_publicaciones: ResumenPublicaciones;
  publicaciones: PublicacionInstagram[];
  /** Solo para la cuenta propia. Null si es ajena; con `no_disponible` lleno si el permiso falta. */
  insights: InsightsPropios | null;
  leido_en: string;
  /** true si salió de la caché en memoria (ver TTL abajo) y no de una llamada nueva. */
  desde_cache: boolean;
}

// ── Resumen calculado en código ───────────────────────────────────────────

function redondear(n: number, decimales = 1): number {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[mitad] : (orden[mitad - 1] + orden[mitad]) / 2;
}

/** REELS / FEED si Graph lo dice; si no, el tipo grueso (IMAGE, VIDEO, CAROUSEL_ALBUM). */
function tipoDe(p: PublicacionInstagram): string {
  return p.media_product_type ?? p.media_type;
}

const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Los promedios, la mediana y el top se calculan ACÁ y no se le pide al modelo
 * que los saque de la lista: promediar 25 números a ojo es justo el error
 * silencioso que termina en un reporte con una cifra que nadie reproduce.
 */
export function resumirPublicaciones(pubs: PublicacionInstagram[]): ResumenPublicaciones {
  if (pubs.length === 0) {
    return {
      cantidad: 0, likes_promedio: 0, comentarios_promedio: 0, interacciones_promedio: 0, likes_mediana: 0,
      likes_total: 0, comentarios_total: 0, interacciones_total: 0,
      por_tipo: [], top: [], desde: null, hasta: null, piezas_por_semana: null,
    };
  }
  const inter = (p: PublicacionInstagram) => p.like_count + p.comments_count;
  const likes = pubs.map((p) => p.like_count);
  const comentarios = pubs.map((p) => p.comments_count);
  const likes_total = suma(likes);
  const comentarios_total = suma(comentarios);

  const grupos = new Map<string, PublicacionInstagram[]>();
  for (const p of pubs) grupos.set(tipoDe(p), [...(grupos.get(tipoDe(p)) ?? []), p]);
  const por_tipo = [...grupos.entries()]
    .map(([tipo, ps]) => ({
      tipo,
      cantidad: ps.length,
      likes_promedio: redondear(suma(ps.map((p) => p.like_count)) / ps.length),
      interacciones_promedio: redondear(suma(ps.map(inter)) / ps.length),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  const top = [...pubs]
    .sort((a, b) => inter(b) - inter(a))
    .slice(0, 3)
    .map((p) => ({
      permalink: p.permalink,
      likes: p.like_count,
      comentarios: p.comments_count,
      interacciones: inter(p),
      tipo: tipoDe(p),
      fecha: p.timestamp.slice(0, 10),
      caption_inicio: p.caption.replace(/\s+/g, ' ').trim().slice(0, 80),
    }));

  const fechas = pubs.map((p) => p.timestamp).filter(Boolean).sort();
  const desde = fechas[0]?.slice(0, 10) ?? null;
  const hasta = fechas[fechas.length - 1]?.slice(0, 10) ?? null;
  let piezas_por_semana: number | null = null;
  if (fechas.length >= 2) {
    const dias = (Date.parse(fechas[fechas.length - 1]) - Date.parse(fechas[0])) / 86_400_000;
    // Con todas las piezas el mismo día no hay ritmo que medir.
    if (dias >= 1) piezas_por_semana = redondear((pubs.length / dias) * 7);
  }

  return {
    cantidad: pubs.length,
    likes_promedio: redondear(likes_total / pubs.length),
    comentarios_promedio: redondear(comentarios_total / pubs.length),
    interacciones_promedio: redondear((likes_total + comentarios_total) / pubs.length),
    likes_mediana: mediana(likes),
    likes_total,
    comentarios_total,
    interacciones_total: likes_total + comentarios_total,
    por_tipo,
    top,
    desde,
    hasta,
    piezas_por_semana,
  };
}

// ── Cuentas guardadas ─────────────────────────────────────────────────────

/**
 * Las cuentas de Instagram guardadas en Marketing → Configuración. Un fallo de
 * BD acá se traduce: el caso concreto que va a pasar es que la migración de
 * MarketingAccount no esté aplicada en producción, y "table does not exist" a
 * secas no dice qué hacer.
 */
export async function cuentasGuardadas(): Promise<CuentaGuardada[]> {
  try {
    return await db.marketingAccount.findMany({
      where: { red: 'INSTAGRAM' },
      select: { usuario: true, url: true, etiqueta: true, esPropia: true },
      orderBy: [{ esPropia: 'desc' }, { createdAt: 'asc' }],
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') {
      throw new Error(
        'La tabla de cuentas de marketing no existe todavía en esta base de datos (falta aplicar la migración 20260910120000_marketing_account). ' +
          'NO reintentes: dile al socio que quien administra Railway tiene que correr `prisma migrate deploy`.',
      );
    }
    throw e;
  }
}

export function faltaConfiguracion(): string | null {
  if (instagramConfigurado()) return null;
  return 'La lectura de Instagram todavía no está configurada (faltan META_SYSTEM_TOKEN y/o INSTAGRAM_ACCOUNT_ID). NO reintentes: dile al socio que esas variables las carga FinZen en Railway.';
}

// ── Lectura + caché ───────────────────────────────────────────────────────

/**
 * Caché en memoria por usuario. Existe por el dashboard: cada vez que alguien
 * abre la pestaña se leería el perfil de nuevo, y Meta cuenta esas llamadas
 * contra el límite por hora de la cuenta. Diez minutos es suficiente para que
 * dos socios mirando el dashboard a la vez cuenten como una lectura, y lo
 * bastante corto para que "recargar" tenga sentido.
 *
 * Es por proceso: en Railway hay una sola instancia, así que alcanza. Si un
 * día hubiera dos, cada una tendría la suya y lo peor que pasa es una llamada
 * de más — no un dato inconsistente.
 */
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { hasta: number; analisis: AnalisisInstagram }>();

export const PUBLICACIONES_POR_DEFECTO = 25;
export const PUBLICACIONES_MAXIMO = 50;

export interface OpcionesAnalisis {
  publicaciones?: number;
  /** Ignora la caché y lee de nuevo. */
  forzar?: boolean;
}

export async function analizarPerfil(cuenta: CuentaGuardada, opts: OpcionesAnalisis = {}): Promise<AnalisisInstagram> {
  const cuantas = Math.min(Math.max(Number(opts.publicaciones) || PUBLICACIONES_POR_DEFECTO, 1), PUBLICACIONES_MAXIMO);
  const clave = `${cuenta.usuario}:${cuantas}`;
  const ahora = Date.now();

  const hit = cache.get(clave);
  if (hit && hit.hasta > ahora && !opts.forzar) {
    return { ...hit.analisis, desde_cache: true };
  }

  const perfil = await getPerfil(cuenta.usuario, cuantas);
  // Los insights son best-effort: un permiso que falta no debe impedir ver el
  // perfil. getInsightsPropios ya reporta por grupo lo que no pudo leer; acá
  // solo se cubre que la llamada entera reviente (p.ej. red caída a mitad).
  let insights: InsightsPropios | null = null;
  if (cuenta.esPropia) {
    insights = await getInsightsPropios().catch((e: unknown) => ({
      ventana: { desde: '', hasta: '', dias: 0 },
      totales: {},
      seguidores_por_dia: [],
      no_disponible: [{ metricas: ['(todas)'], motivo: e instanceof Error ? e.message : String(e) }],
    }));
  }

  const resumen = resumirPublicaciones(perfil.publicaciones);
  const analisis: AnalisisInstagram = {
    cuenta: { usuario: perfil.usuario, url: cuenta.url, etiqueta: cuenta.etiqueta, es_de_finzen: cuenta.esPropia },
    perfil: {
      nombre: perfil.nombre,
      biografia: perfil.biografia,
      sitio_web: perfil.sitio_web,
      seguidores: perfil.seguidores,
      seguidos: perfil.seguidos,
      publicaciones_totales: perfil.publicaciones_totales,
      ratio_seguidores_seguidos: perfil.seguidos > 0 ? redondear(perfil.seguidores / perfil.seguidos) : null,
    },
    tasa_engagement_pct:
      perfil.seguidores > 0 && resumen.cantidad > 0 ? redondear((resumen.interacciones_promedio / perfil.seguidores) * 100, 2) : null,
    resumen_publicaciones: resumen,
    publicaciones: perfil.publicaciones,
    insights,
    leido_en: perfil.leido_en,
    desde_cache: false,
  };

  cache.set(clave, { hasta: ahora + TTL_MS, analisis });
  return analisis;
}

/** Solo para tests. */
export function vaciarCacheInstagram(): void {
  cache.clear();
}
