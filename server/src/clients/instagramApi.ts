import { config } from '../config';
import { GraphApiError, graphRequest, numeroGraph, explicarErrorGraph } from './graphApi';

// ─────────────────────────────────────────────────────────────────────────
// Cliente de Instagram (Graph API) — lectura de perfiles.
//
// Misma API, misma versión y MISMO token que la Marketing API: lo que cambia
// son los permisos que ese token necesita (instagram_basic y
// pages_read_engagement) y los nodos que se consultan.
//
// CÓMO FUNCIONA `business_discovery`, que es lo que hace esto posible: no se
// consulta el perfil ajeno directamente. Se consulta NUESTRO nodo de Instagram
// —el de FinZen, INSTAGRAM_ACCOUNT_ID— y se le pide, como campo, el perfil de
// otro usuario. Por eso hace falta la cuenta propia incluso para leer un
// competidor, y por eso la cuenta propia tiene que ser Business o Creator y
// estar vinculada a una página de Facebook.
//
// LO QUE ESTO DEVUELVE Y LO QUE NO: business_discovery da lo PÚBLICO —
// seguidores, cantidad de publicaciones, y por publicación likes y comentarios.
// NO da alcance, impresiones ni guardados, ni de la cuenta propia ni de nadie:
// esas viven en el nodo de insights de la cuenta propia y necesitan un permiso
// aparte (instagram_manage_insights). Eso es un segundo paso, no está acá.
//
// Consecuencia para el agente: con este archivo se puede contestar "qué
// publicación tuvo más likes", NO "qué contenido conviene repetir" — para eso
// hace falta el alcance, y el skill lectura-kpis-social lo dice explícito:
// views y likes son pulso, y el pulso contextualiza pero no decide.
// ─────────────────────────────────────────────────────────────────────────

/** Cuántas publicaciones se piden por defecto. Graph topea en 25 por página aquí. */
const MEDIA_POR_DEFECTO = 25;
const MEDIA_MAXIMO = 50;

/**
 * El nodo de Instagram de FinZen. Es el punto de partida de toda consulta,
 * incluso de perfiles ajenos (ver el encabezado).
 */
function cuentaPropia(): string {
  const id = config.instagram.accountId;
  if (!id) {
    throw new GraphApiError(
      0,
      'Falta INSTAGRAM_ACCOUNT_ID (el id de la cuenta de Instagram de FinZen). ' +
        'Se obtiene desde la página de Facebook vinculada: GET /{page-id}?fields=instagram_business_account. ' +
        'Sin ese id no se puede consultar ningún perfil, ni el propio ni uno ajeno.',
    );
  }
  return id;
}

/**
 * Traducción de los fallos propios de Instagram.
 *
 * Estos NO tienen un código numérico estable que los distinga —vienen con el
 * genérico 100— así que hay que reconocerlos por el texto. Es frágil a
 * propósito y acotado: si el texto no matchea, cae en la tabla común y se
 * devuelve el mensaje crudo de Meta, que es peor que una traducción pero mejor
 * que una traducción equivocada.
 */
function explicarErrorInstagram(code: number | null, mensaje: string): string {
  const m = mensaje.toLowerCase();

  if (m.includes('does not exist') || m.includes('cannot be loaded') || m.includes('not found')) {
    return `Instagram no encontró ese perfil, o no se puede leer con este token (${mensaje}). ` +
      'Las causas posibles: el usuario está mal escrito, la cuenta es privada, o no es una cuenta Business ni Creator — business_discovery solo lee cuentas profesionales públicas.';
  }
  if (m.includes('business account') || m.includes('professional account')) {
    return `Ese perfil no es una cuenta Business ni Creator, así que Instagram no permite leerlo (${mensaje}). ` +
      'No hay forma oficial de obtener datos de una cuenta personal.';
  }
  if (m.includes('instagram_basic') || m.includes('pages_read_engagement') || m.includes('permission')) {
    return `Al token le falta un permiso de Instagram (${mensaje}). Hacen falta instagram_basic y pages_read_engagement.`;
  }

  return explicarErrorGraph(code, mensaje);
}

// ── Tipos ─────────────────────────────────────────────────────────────────

export interface PublicacionInstagram {
  id: string;
  /** El pie de la publicación. Puede venir vacío: hay piezas sin texto. */
  caption: string;
  like_count: number;
  comments_count: number;
  /** IMAGE | VIDEO | CAROUSEL_ALBUM */
  media_type: string;
  /** Más fino que media_type: distingue REELS de FEED. Puede no venir. */
  media_product_type: string | null;
  permalink: string;
  /** ISO 8601 con zona. */
  timestamp: string;
}

export interface PerfilInstagramLeido {
  usuario: string;
  nombre: string;
  biografia: string;
  sitio_web: string | null;
  seguidores: number;
  seguidos: number;
  publicaciones_totales: number;
  /** Las últimas N publicaciones, de la más reciente a la más vieja. */
  publicaciones: PublicacionInstagram[];
  /** Cuándo se leyó. Los valores son de ESTE instante: la API no da histórico. */
  leido_en: string;
}

// ── Lectura ───────────────────────────────────────────────────────────────

const CAMPOS_MEDIA = 'id,caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp';
const CAMPOS_PERFIL = 'username,name,biography,website,followers_count,follows_count,media_count';

/**
 * Lee un perfil de Instagram por su nombre de usuario.
 *
 * Sirve para la cuenta propia y para cualquier cuenta Business o Creator
 * PÚBLICA — o sea, también para mirar competidores, con la salvedad de que de
 * ellos solo se obtiene lo público.
 *
 * `usuario` va sin arroba y en minúsculas; de una URL se saca con
 * `util/instagram.ts`. NO se valida acá el formato a propósito: quien llama ya
 * pasó por ese parseo, y duplicar la validación haría que las dos versiones se
 * separen con el tiempo.
 */
export async function getPerfil(usuario: string, cuantasPublicaciones = MEDIA_POR_DEFECTO): Promise<PerfilInstagramLeido> {
  const limite = Math.max(1, Math.min(cuantasPublicaciones, MEDIA_MAXIMO));

  const campo = construirCampoBusinessDiscovery(usuario, limite);

  interface Respuesta {
    business_discovery?: Record<string, unknown> & { media?: { data?: Array<Record<string, unknown>> } };
  }

  const r = await graphRequest<Respuesta>(
    'GET',
    `/${cuentaPropia()}`,
    { fields: campo },
    undefined,
    explicarErrorInstagram,
  );

  const bd = r.business_discovery;
  if (!bd) {
    // Graph puede responder 200 sin el campo cuando el perfil no es legible.
    // Sin este chequeo se devolvería un perfil con todo en cero, que es peor:
    // parece un dato real y dice que la cuenta no tiene nada.
    throw new GraphApiError(
      200,
      `Instagram respondió sin datos para "@${usuario}". Suele significar que la cuenta es privada, personal (no Business ni Creator), o que el usuario no existe.`,
    );
  }

  return {
    usuario: String(bd.username ?? usuario),
    nombre: String(bd.name ?? ''),
    biografia: String(bd.biography ?? ''),
    sitio_web: bd.website ? String(bd.website) : null,
    seguidores: numeroGraph(bd.followers_count),
    seguidos: numeroGraph(bd.follows_count),
    publicaciones_totales: numeroGraph(bd.media_count),
    publicaciones: normalizarPublicaciones(bd.media?.data ?? []),
    leido_en: new Date().toISOString(),
  };
}

/** Exportada para poder probarla sin red: es donde se pierde la mitad de los datos si se hace mal. */
export function normalizarPublicaciones(filas: Array<Record<string, unknown>>): PublicacionInstagram[] {
  return filas.map((m) => ({
    id: String(m.id ?? ''),
    caption: String(m.caption ?? ''),
    // Los contadores vienen como número acá (no como string, a diferencia de
    // insights de publicidad), pero se pasan por numeroGraph igual: una
    // publicación con los comentarios desactivados NO trae comments_count, y
    // sin default eso sería NaN.
    like_count: numeroGraph(m.like_count),
    comments_count: numeroGraph(m.comments_count),
    media_type: String(m.media_type ?? 'UNKNOWN'),
    media_product_type: m.media_product_type ? String(m.media_product_type) : null,
    permalink: String(m.permalink ?? ''),
    timestamp: String(m.timestamp ?? ''),
  }));
}

/**
 * La sintaxis de business_discovery es un campo anidado con parámetro, no un
 * query param: `business_discovery.username(X){campos,media.limit(N){...}}`.
 *
 * Exportada para poder probarla sin red: es fácil de romper —un paréntesis, una
 * coma— y difícil de ver roto, porque Graph responde con un error genérico de
 * parámetros que no dice dónde está la falla.
 */
export function construirCampoBusinessDiscovery(usuario: string, limite: number): string {
  return `business_discovery.username(${usuario}){${CAMPOS_PERFIL},media.limit(${limite}){${CAMPOS_MEDIA}}}`;
}

/** ¿Está configurado lo mínimo para poder leer Instagram? */
export function instagramConfigurado(): boolean {
  return Boolean(config.meta.systemToken && config.instagram.accountId);
}
