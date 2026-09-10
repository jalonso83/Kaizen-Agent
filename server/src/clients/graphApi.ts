import { config } from '../config';

// ─────────────────────────────────────────────────────────────────────────
// Transporte compartido de la Graph API de Meta.
//
// Vive aparte porque hay DOS clientes encima: la Marketing API (publicidad,
// clients/metaApi.ts) e Instagram (clients/instagramApi.ts). Son la misma API,
// la misma versión y el MISMO token — lo único que cambia son los nodos que se
// consultan y los permisos que ese token necesita.
//
// Antes esto vivía dentro de metaApi.ts. Se extrajo al sumar Instagram: la
// tabla de traducción de errores de abajo es conocimiento operativo compartido
// (token vencido, límite por volumen, permiso faltante) y tenerla duplicada
// garantiza que un día se arregle una copia y no la otra.
//
// El token va en el header Authorization y NUNCA en la query string: los
// access tokens en URLs terminan en logs de proxies, en el historial y en
// cualquier herramienta que registre la URL completa.
// ─────────────────────────────────────────────────────────────────────────

export class GraphApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Código de error de Graph (no HTTP). 190 = token, 4/17/80004 = rate limit. */
    public readonly code: number | null = null,
    /** Identificador que Meta pide para reportar un problema en su soporte. */
    public readonly fbtraceId: string | null = null,
  ) {
    super(message);
    this.name = 'GraphApiError';
  }
}

/**
 * Traduce los códigos de Graph que hay que saber distinguir al operar.
 *
 * El criterio de qué se traduce: los errores donde la acción a tomar es
 * distinta. Un token vencido se arregla regenerándolo; un límite por volumen
 * se arregla esperando y NO reintentando; un permiso faltante se arregla del
 * lado de Meta. Un mensaje crudo de Graph no siempre deja claro cuál de los
 * tres es.
 */
export function explicarErrorGraph(code: number | null, mensaje: string): string {
  switch (code) {
    case 190:
      return `El token de Meta no sirve o expiró (${mensaje}). Hay que regenerar META_SYSTEM_TOKEN.`;
    case 200:
    case 294:
      return `El token no tiene permiso para esta operación (${mensaje}). Revisar los permisos: ads_read para publicidad, instagram_basic y pages_read_engagement para Instagram.`;
    case 4:
    case 17:
    case 80004:
      return `Meta está limitando por volumen de llamadas (${mensaje}). No reintentar en bucle: esperar.`;
    case 100:
      return `Meta rechazó los parámetros (${mensaje}). Suele ser un campo mal escrito o un id que no existe.`;
    case 110:
      return `El objeto que se pidió no existe o no es visible con este token (${mensaje}).`;
    default:
      return mensaje;
  }
}

export type MetodoGraph = 'GET' | 'POST';

/**
 * Una llamada a la Graph API. Devuelve el JSON crudo tipado por quien llama.
 *
 * `traducir` permite que cada cliente agregue su propia lectura del error sin
 * perder la tabla común: Instagram, por ejemplo, falla de formas que no tienen
 * un código propio y hay que reconocer por el texto.
 */
export async function graphRequest<T>(
  metodo: MetodoGraph,
  path: string,
  params: Record<string, string> = {},
  body?: Record<string, unknown>,
  traducir?: (code: number | null, mensaje: string) => string,
): Promise<T> {
  if (!config.meta.systemToken) {
    throw new GraphApiError(0, 'Falta META_SYSTEM_TOKEN. Kaizen no puede hablar con Meta sin credencial.');
  }

  const url = new URL(`${config.meta.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${config.meta.systemToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
  };

  // Graph puede devolver 200 con un `error` adentro: chequear solo res.ok deja
  // pasar el fallo y el error aparece después, al leer un campo que no vino.
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    const code = typeof e.code === 'number' ? e.code : null;
    const crudo = e.message ?? `Graph API error ${res.status}`;
    const mensaje = (traducir ?? explicarErrorGraph)(code, crudo);
    throw new GraphApiError(res.status, mensaje, code, e.fbtrace_id ?? null);
  }

  return json as T;
}

/**
 * Graph devuelve TODAS las métricas numéricas como string. `Number(undefined)`
 * da NaN, que se propaga en silencio hasta un reporte que dice "CAC: NaN" — de
 * ahí el default explícito.
 */
export function numeroGraph(v: unknown, siFalta = 0): number {
  if (v == null || v === '') return siFalta;
  const n = Number(v);
  return Number.isFinite(n) ? n : siFalta;
}
