import { TiktokApiError } from '../../clients/tiktokApi';
import { perfilDeTiktok, UrlTiktokInvalida } from '../../util/tiktok';
import { analizarTiktok, cuentasTiktokGuardadas, faltaConfiguracionTiktok, VIDEOS_MAXIMO, VIDEOS_POR_DEFECTO } from '../../services/tiktokAnalisis';
import type { KaizenTool } from './guard';

// ─────────────────────────────────────────────────────────────────────────
// get_tiktok_profile — ámbito marketing, SOLO LECTURA (2026-09-18).
//
// Misma regla que Instagram (solo perfiles guardados en Marketing →
// Configuración) más una restricción que viene de TikTok y no de Kaizen: la
// Display API solo lee la cuenta que autorizó la app. Los competidores se
// pueden GUARDAR (para tener el enlace) pero no leer; la tool lo dice, en
// vez de fallar con un error de la API que no explica nada.
// ─────────────────────────────────────────────────────────────────────────

const LECTURA_NOTE =
  'CÓMO LEER ESTO (el método completo está en el skill lectura-perfil-tiktok; cárgalo antes de interpretar): en TikTok la base es quien VIO el video, no quien sigue la cuenta (la distribución es por For You). Por eso `tasa_engagement_views_pct` (interacciones / views) es la tasa natural de esta red; ' +
  '`tasa_engagement_pct` (sobre seguidores) está solo para comparar con Instagram y suele dar números altos que no significan lo mismo. ' +
  '`views_mediana` es el nivel real de la cuenta: un video viral en la muestra multiplica el promedio. Interacciones = likes + comentarios + compartidos; los compartidos son la señal más fuerte. ' +
  'Los promedios y el top ya vienen calculados en `resumen_videos`: úsalos tal cual.';

const INSTANTE_NOTE =
  'OJO con el tiempo: los números son de ESTE instante (leido_en). Para decir cuánto creció usa `historico` (`delta_7d`, `delta_30d`; `dias` es la distancia real; null = no hay lectura tan vieja, no lo estimes). En `historico`, `likes_mediana` y `delta.mediana` son la MEDIANA DE VIEWS por video (el campo comparte nombre con Instagram): un delta de mediana positivo a 30 días es la señal de que la cuenta sube de nivel, no un viral. ' +
  'Un video de hace 2 días sigue sumando views; no lo compares con uno de hace 2 meses. La API no da alcance ni retención de video: si el socio pregunta por eso, di que esta fuente no lo tiene.';

export const getTiktokProfileTool: KaizenTool = {
  name: 'get_tiktok_profile',
  ambito: 'marketing',
  description:
    'Lee la cuenta de TikTok de FinZen (la guardada como propia en Marketing → Configuración): seguidores, seguidos, likes totales, videos totales, los últimos N videos con views/likes/comentarios/compartidos/duración, un resumen ya calculado (mediana de views, promedios, top 3 por views, ritmo) y el `historico` con deltas a 7 y 30 días. ' +
    'SOLO la cuenta propia: TikTok no permite leer perfiles ajenos por su API; si el socio pide un competidor, di que no hay forma oficial y que queda para un proveedor de datos. ' +
    'LLÁMALA SIEMPRE antes de afirmar cualquier cifra de TikTok, y carga el skill lectura-perfil-tiktok ANTES de interpretar: TikTok no se lee como Instagram (la base es quien vio el video, no quien sigue; un viral distorsiona todo). Es lo mismo que muestra el Dashboard.',
  inputSchema: {
    type: 'object',
    properties: {
      usuario: { type: 'string', description: 'Opcional. Usuario o URL del perfil. Si falta, se lee la cuenta de FinZen.' },
      videos: { type: 'number', description: `Cuántos videos recientes traer (opcional, default ${VIDEOS_POR_DEFECTO}, tope ${VIDEOS_MAXIMO}).` },
    },
  },
  async execute(input) {
    const falta = faltaConfiguracionTiktok();
    if (falta) throw new Error(falta);

    const cuentas = await cuentasTiktokGuardadas();
    const entrada = (input.usuario as string | undefined)?.trim();
    let cuenta = cuentas.find((c) => c.esPropia);
    if (entrada) {
      let usuario: string;
      try {
        usuario = perfilDeTiktok(entrada).usuario;
      } catch (e) {
        if (e instanceof UrlTiktokInvalida) throw new Error(`"${entrada}" no es un usuario ni una URL de perfil de TikTok válida: ${e.message}.`);
        throw e;
      }
      const pedida = cuentas.find((c) => c.usuario === usuario);
      if (!pedida) {
        throw new Error(`@${usuario} no está entre los perfiles de TikTok guardados en Marketing → Configuración. NO reintentes: dile al socio que lo agregue ahí si es la cuenta de FinZen.`);
      }
      cuenta = pedida;
    }
    if (!cuenta) {
      throw new Error('No hay una cuenta de TikTok marcada como la de FinZen en Marketing → Configuración. Dile al socio que la agregue ahí; hasta entonces no puedo leer TikTok.');
    }

    let analisis;
    try {
      analisis = await analizarTiktok(cuenta, { videos: Number(input.videos) || undefined });
    } catch (e) {
      if (e instanceof TiktokApiError) throw new Error(e.message);
      throw e;
    }
    return [LECTURA_NOTE, INSTANTE_NOTE, JSON.stringify(analisis)].join('\n');
  },
};
