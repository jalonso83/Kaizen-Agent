import { Prisma } from '@prisma/client';
import { db } from '../../db';
import { getPerfil, instagramConfigurado, type PublicacionInstagram } from '../../clients/instagramApi';
import { GraphApiError } from '../../clients/graphApi';
import { perfilDeInstagram, UrlInstagramInvalida } from '../../util/instagram';
import type { KaizenTool } from './guard';

// ─────────────────────────────────────────────────────────────────────────
// Tools de Instagram — ámbito marketing, SOLO LECTURA (2026-09-11).
//
// Cierra el circuito que abrió el apartado de Marketing: los socios guardan
// perfiles en Configuración (routes/marketing.ts → MarketingAccount), y con
// esto Kaizen los puede leer por chat.
//
// LA REGLA QUE ESTRUCTURA TODO: Kaizen solo lee perfiles que estén GUARDADOS
// en ese apartado. No es un límite técnico —business_discovery lee cualquier
// cuenta profesional pública— sino una decisión: qué mira Kaizen lo decide un
// socio desde la configuración, no el modelo a pedido en un chat. Si el socio
// quiere que Kaizen mire una cuenta nueva, la agrega ahí (dos clics) y la
// tool la ve en el turno siguiente. El error, cuando pide una que no está,
// dice exactamente eso.
//
// El patrón de los avisos que viajan CON el dato es el de kpis.ts y meta.ts:
// las notas de abajo son formas concretas de leer mal un perfil, y el system
// prompt solo no alcanza para evitarlas. La más importante es la del pulso:
// likes y comentarios son lo único que da esta API, y el skill
// lectura-kpis-social es tajante en que eso contextualiza pero no decide.
// ─────────────────────────────────────────────────────────────────────────

const PULSO_NOTE =
  'LO QUE ESTO ES Y LO QUE NO: business_discovery da solo lo PÚBLICO del perfil — seguidores, y por publicación likes y comentarios. ' +
  'NO trae alcance, impresiones, guardados, clicks al link ni registros atribuidos. Según el skill lectura-kpis-social, likes y comentarios son PULSO: ' +
  'sirven para contextualizar ("qué pieza llamó más la atención"), no para decidir qué contenido repetir ni para afirmar que una pieza "funcionó". ' +
  'Si el socio pregunta por alcance, retención de video o registros que trajo una pieza, di que esta fuente no lo tiene.';

const INSTANTE_NOTE =
  'OJO con el tiempo: los números son de ESTE instante (leido_en). La API no da histórico, así que no puedes decir cuánto creció una cuenta ' +
  'ni comparar con "la semana pasada" salvo que tengas una lectura anterior en ESTA conversación. Y los likes de una pieza de hace 2 días no son comparables con los de una de hace 2 meses: la nueva sigue sumando.';

const AJENA_NOTE =
  'Este perfil NO es el de FinZen: es un tercero. Lo que se ve es lo mismo que vería cualquiera desde la app. No infieras su estrategia, gasto ni resultados de negocio a partir de likes.';

/** Cuántas publicaciones se piden si el modelo no dice. Alcanza para un mes típico. */
const PUBLICACIONES_POR_DEFECTO = 25;
const PUBLICACIONES_MAXIMO = 50;

// ── Resumen calculado en código ───────────────────────────────────────────

export interface ResumenPublicaciones {
  cantidad: number;
  /** Promedios sobre las publicaciones leídas, redondeados a 1 decimal. */
  likes_promedio: number;
  comentarios_promedio: number;
  /** Mediana de likes: con una pieza viral el promedio miente. */
  likes_mediana: number;
  /** Conteo y promedio de likes por tipo (REELS, FEED, ...). */
  por_tipo: Array<{ tipo: string; cantidad: number; likes_promedio: number }>;
  /** Las 3 con más likes, para "qué llamó más la atención". */
  top_likes: Array<{ permalink: string; likes: number; comentarios: number; tipo: string; fecha: string; caption_inicio: string }>;
  /** Fecha de la más vieja y la más nueva leídas: es la ventana real del resumen. */
  desde: string | null;
  hasta: string | null;
}

function redondear(n: number): number {
  return Math.round(n * 10) / 10;
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

/**
 * Los promedios, la mediana y el top se calculan ACÁ y no se le pide al modelo
 * que los saque de la lista: promediar 25 números a ojo es justo el error
 * silencioso que termina en un reporte con una cifra que nadie reproduce.
 *
 * Exportada para probarla sin red.
 */
export function resumirPublicaciones(pubs: PublicacionInstagram[]): ResumenPublicaciones {
  if (pubs.length === 0) {
    return { cantidad: 0, likes_promedio: 0, comentarios_promedio: 0, likes_mediana: 0, por_tipo: [], top_likes: [], desde: null, hasta: null };
  }
  const likes = pubs.map((p) => p.like_count);
  const comentarios = pubs.map((p) => p.comments_count);
  const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const grupos = new Map<string, number[]>();
  for (const p of pubs) {
    const t = tipoDe(p);
    grupos.set(t, [...(grupos.get(t) ?? []), p.like_count]);
  }
  const por_tipo = [...grupos.entries()]
    .map(([tipo, ls]) => ({ tipo, cantidad: ls.length, likes_promedio: redondear(suma(ls) / ls.length) }))
    .sort((a, b) => b.cantidad - a.cantidad);

  const top_likes = [...pubs]
    .sort((a, b) => b.like_count - a.like_count)
    .slice(0, 3)
    .map((p) => ({
      permalink: p.permalink,
      likes: p.like_count,
      comentarios: p.comments_count,
      tipo: tipoDe(p),
      fecha: p.timestamp.slice(0, 10),
      caption_inicio: p.caption.replace(/\s+/g, ' ').trim().slice(0, 80),
    }));

  const fechas = pubs.map((p) => p.timestamp).filter(Boolean).sort();

  return {
    cantidad: pubs.length,
    likes_promedio: redondear(suma(likes) / pubs.length),
    comentarios_promedio: redondear(suma(comentarios) / pubs.length),
    likes_mediana: mediana(likes),
    por_tipo,
    top_likes,
    desde: fechas[0]?.slice(0, 10) ?? null,
    hasta: fechas[fechas.length - 1]?.slice(0, 10) ?? null,
  };
}

// ── Cuentas guardadas ─────────────────────────────────────────────────────

interface CuentaGuardada {
  usuario: string;
  url: string;
  etiqueta: string | null;
  esPropia: boolean;
}

/**
 * Las cuentas de Instagram guardadas en Marketing → Configuración. Un fallo de
 * BD acá se traduce: el caso concreto que va a pasar es que la migración de
 * MarketingAccount no esté aplicada en producción, y "table does not exist" a
 * secas no le dice al modelo (ni al socio) qué hacer.
 */
async function cuentasGuardadas(): Promise<CuentaGuardada[]> {
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

function describirCuenta(c: CuentaGuardada): string {
  return `@${c.usuario}${c.esPropia ? ' (la de FinZen)' : ''}${c.etiqueta ? ` — ${c.etiqueta}` : ''}`;
}

function verificarConfig(): void {
  if (!instagramConfigurado()) {
    throw new Error(
      'La lectura de Instagram todavía no está configurada (faltan META_SYSTEM_TOKEN y/o INSTAGRAM_ACCOUNT_ID). ' +
        'NO reintentes: dile al socio que esas variables las carga FinZen en Railway.',
    );
  }
}

// ── Tools ─────────────────────────────────────────────────────────────────

export const listMarketingAccountsTool: KaizenTool = {
  name: 'list_marketing_accounts',
  ambito: 'marketing',
  description:
    'Lista los perfiles de redes sociales guardados en el apartado de Marketing (Configuración → Perfiles): usuario, URL, etiqueta y cuál es el de FinZen. ' +
    'Úsala para saber qué cuentas puede leer Kaizen antes de llamar a get_instagram_profile, o cuando el socio pregunte qué perfiles hay configurados. ' +
    'Kaizen solo puede leer perfiles que estén en esta lista; si el socio quiere otro, lo agrega él en Marketing → Configuración.',
  inputSchema: { type: 'object', properties: {} },
  async execute() {
    const cuentas = await cuentasGuardadas();
    if (cuentas.length === 0) {
      return 'No hay ningún perfil guardado todavía. El socio puede agregar el de FinZen (y los de terceros que quiera seguir) en Marketing → Configuración → Perfiles; hasta entonces no puedo leer Instagram.';
    }
    return JSON.stringify({ red: 'INSTAGRAM', cuentas });
  },
};

export const getInstagramProfileTool: KaizenTool = {
  name: 'get_instagram_profile',
  ambito: 'marketing',
  description:
    'Lee un perfil de Instagram GUARDADO en Marketing → Configuración: seguidores, seguidos, cantidad de publicaciones, y las últimas N publicaciones con likes y comentarios, más un resumen ya calculado (promedios, mediana, por tipo, top 3). ' +
    'Sin parámetros lee la cuenta de FinZen; con "usuario" lee ese perfil, que tiene que estar guardado (si no, la tool te dice cuáles hay). ' +
    'LLÁMALA SIEMPRE antes de afirmar cualquier cifra de Instagram. SOLO trae lo público: likes y comentarios son pulso, no funnel — no trae alcance, guardados, clicks ni registros atribuidos, y los números son del instante en que se lee (sin histórico).',
  inputSchema: {
    type: 'object',
    properties: {
      usuario: {
        type: 'string',
        description: 'Usuario de Instagram (con o sin @, o la URL del perfil). Opcional: si falta, se lee la cuenta de FinZen.',
      },
      publicaciones: {
        type: 'number',
        description: `Cuántas publicaciones recientes traer (opcional, default ${PUBLICACIONES_POR_DEFECTO}, tope ${PUBLICACIONES_MAXIMO}).`,
      },
    },
  },
  async execute(input) {
    verificarConfig();

    const cuentas = await cuentasGuardadas();
    const entrada = (input.usuario as string | undefined)?.trim();

    let cuenta: CuentaGuardada | undefined;
    if (!entrada) {
      cuenta = cuentas.find((c) => c.esPropia);
      if (!cuenta) {
        throw new Error(
          'No hay una cuenta marcada como la de FinZen en Marketing → Configuración. ' +
            (cuentas.length
              ? `Perfiles guardados: ${cuentas.map(describirCuenta).join(', ')}. Pide uno por su usuario, o dile al socio que marque cuál es la de FinZen.`
              : 'Tampoco hay otros perfiles guardados: dile al socio que agregue el de FinZen ahí.'),
        );
      }
    } else {
      let usuario: string;
      try {
        usuario = perfilDeInstagram(entrada).usuario;
      } catch (e) {
        if (e instanceof UrlInstagramInvalida) {
          throw new Error(`"${entrada}" no es un usuario ni una URL de perfil de Instagram válida: ${e.message}. Corrige el parámetro.`);
        }
        throw e;
      }
      cuenta = cuentas.find((c) => c.usuario === usuario);
      if (!cuenta) {
        throw new Error(
          `@${usuario} no está entre los perfiles guardados, y Kaizen solo lee los que están en Marketing → Configuración. ` +
            (cuentas.length ? `Los guardados son: ${cuentas.map(describirCuenta).join(', ')}. ` : 'No hay ninguno guardado todavía. ') +
            'NO reintentes con otra escritura del mismo usuario: dile al socio que lo agregue ahí si quiere que lo lea.',
        );
      }
    }

    const cuantas = Math.min(Math.max(Number(input.publicaciones) || PUBLICACIONES_POR_DEFECTO, 1), PUBLICACIONES_MAXIMO);

    let perfil;
    try {
      perfil = await getPerfil(cuenta.usuario, cuantas);
    } catch (e) {
      // Los errores del cliente ya vienen redactados para el modelo.
      if (e instanceof GraphApiError) throw new Error(e.message);
      throw e;
    }

    const payload = {
      cuenta: { usuario: perfil.usuario, url: cuenta.url, etiqueta: cuenta.etiqueta, es_de_finzen: cuenta.esPropia },
      perfil: {
        nombre: perfil.nombre,
        biografia: perfil.biografia,
        sitio_web: perfil.sitio_web,
        seguidores: perfil.seguidores,
        seguidos: perfil.seguidos,
        publicaciones_totales: perfil.publicaciones_totales,
      },
      leido_en: perfil.leido_en,
      resumen_publicaciones: resumirPublicaciones(perfil.publicaciones),
      publicaciones: perfil.publicaciones,
    };

    const notas = [PULSO_NOTE, INSTANTE_NOTE];
    if (!cuenta.esPropia) notas.push(AJENA_NOTE);
    return [...notas, JSON.stringify(payload)].join('\n');
  },
};
