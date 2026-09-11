import { GraphApiError } from '../../clients/graphApi';
import { perfilDeInstagram, UrlInstagramInvalida } from '../../util/instagram';
import {
  analizarPerfil,
  cuentasGuardadas,
  faltaConfiguracion,
  PUBLICACIONES_MAXIMO,
  PUBLICACIONES_POR_DEFECTO,
  type CuentaGuardada,
} from '../../services/instagramAnalisis';
import type { KaizenTool } from './guard';

// ─────────────────────────────────────────────────────────────────────────
// Tools de Instagram — ámbito marketing, SOLO LECTURA (2026-09-11).
//
// Cierra el circuito que abrió el apartado de Marketing: los socios guardan
// perfiles en Configuración (routes/marketing.ts → MarketingAccount), y con
// esto Kaizen los puede leer por chat. El análisis en sí (métricas, resumen,
// insights) vive en services/instagramAnalisis.ts y es el MISMO que muestra
// el Dashboard: un solo número para cada cosa.
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
// likes y comentarios contextualizan pero no deciden (skill
// lectura-kpis-social); lo que sí decide —alcance, guardados, taps al link—
// solo viene en `insights`, y solo para la cuenta de FinZen.
// ─────────────────────────────────────────────────────────────────────────

const PULSO_NOTE =
  'CÓMO LEER ESTO: `perfil` y `publicaciones` son lo PÚBLICO (business_discovery): seguidores, y por pieza likes y comentarios. ' +
  'Según el skill lectura-kpis-social eso es PULSO: sirve para contextualizar ("qué pieza llamó más la atención"), no para decidir qué contenido repetir ni para afirmar que una pieza "funcionó". ' +
  '`tasa_engagement_pct` es interacciones promedio por pieza sobre seguidores, la definición estándar para comparar cuentas; dilo así si la citas. ' +
  'Los promedios, la mediana y el top ya vienen calculados en `resumen_publicaciones`: úsalos tal cual, no los recalcules.';

const INSIGHTS_NOTE =
  '`insights` es lo que SÍ decide (solo existe para la cuenta de FinZen): alcance, views, cuentas que interactuaron, guardados, compartidos, taps al link, altas/bajas de seguidores y seguidores nuevos por día, de los últimos 28 días. ' +
  'Si `insights.no_disponible` trae algo, esas métricas no llegaron por el motivo que dice (casi siempre falta el permiso instagram_manage_insights): dilo, no las estimes.';

const INSTANTE_NOTE =
  'OJO con el tiempo: `perfil` y `publicaciones` son de ESTE instante (leido_en), sin histórico — no puedes decir cuánto creció una cuenta salvo que tengas una lectura anterior en ESTA conversación o uses `insights.seguidores_por_dia`. ' +
  'Y los likes de una pieza de hace 2 días no son comparables con los de una de hace 2 meses: la nueva sigue sumando.';

const AJENA_NOTE =
  'Este perfil NO es el de FinZen: es un tercero. Lo que se ve es lo mismo que vería cualquiera desde la app, y no hay `insights`. No infieras su estrategia, gasto ni resultados de negocio a partir de likes.';

function describirCuenta(c: CuentaGuardada): string {
  return `@${c.usuario}${c.esPropia ? ' (la de FinZen)' : ''}${c.etiqueta ? ` — ${c.etiqueta}` : ''}`;
}

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
    'Lee un perfil de Instagram GUARDADO en Marketing → Configuración: seguidores, seguidos, publicaciones totales, tasa de engagement, las últimas N publicaciones con likes y comentarios, y un resumen ya calculado (promedios, mediana, interacciones, por tipo, top 3, ritmo de publicación). ' +
    'Para la cuenta de FinZen trae además `insights` de los últimos 28 días (alcance, views, guardados, compartidos, taps al link, seguidores nuevos por día) si el token tiene permiso. ' +
    'Sin parámetros lee la cuenta de FinZen; con "usuario" lee ese perfil, que tiene que estar guardado (si no, la tool te dice cuáles hay). ' +
    'LLÁMALA SIEMPRE antes de afirmar cualquier cifra de Instagram. Es lo mismo que muestra el Dashboard de Marketing: si el socio pregunta por un número que vio ahí, sale de acá.',
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
    const falta = faltaConfiguracion();
    if (falta) throw new Error(falta);

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

    let analisis;
    try {
      analisis = await analizarPerfil(cuenta, { publicaciones: Number(input.publicaciones) || undefined });
    } catch (e) {
      // Los errores del cliente ya vienen redactados para el modelo.
      if (e instanceof GraphApiError) throw new Error(e.message);
      throw e;
    }

    const notas = [PULSO_NOTE, INSTANTE_NOTE, cuenta.esPropia ? INSIGHTS_NOTE : AJENA_NOTE];
    return [...notas, JSON.stringify(analisis)].join('\n');
  },
};
