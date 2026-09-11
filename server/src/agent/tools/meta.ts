import { getAccount, getCampaigns, getSpend, MetaApiError } from '../../clients/metaApi';
import { config } from '../../config';
import type { KaizenTool } from './guard';

// ─────────────────────────────────────────────────────────────────────────
// Tools de Meta — Fase 2, PRD §2.2. SOLO LECTURA.
//
// Por qué no está create_meta_campaign_draft acá todavía: el PRD §2.1 manda
// `ads_read` primero y `ads_management` recién tras ≥1 semana de lecturas
// estables. Darle al modelo una tool que no puede usar no lo hace más seguro,
// lo hace perder turnos intentándola. Entra cuando entre el permiso, y va a
// pasar por el mismo gate de confirmación que las campañas de Fase 1.
//
// El patrón de los avisos que viajan CON el dato es el de kpis.ts: las tres
// notas de abajo son formas concretas de leer mal esta respuesta, y el system
// prompt solo no alcanza para evitarlas.
// ─────────────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El riesgo más grande de esta integración, y el que nadie ve venir.
 *
 * Cruzar gasto de Meta con adquisición de FinZen exige unir la campaña de Meta
 * con el `utm_campaign` que FinZen registró. Son dos sistemas distintos
 * llenados por personas distintas: si en Meta la campaña se llama
 * "FZ | Retargeting | Ago" y el utm dice "retargeting_ago", no unen. Nadie
 * confirmó todavía que coincidan (pendiente con FinZen, 2026-08-20).
 *
 * Por eso el cruce NO se hace en código: hacerlo sería congelar una regla de
 * unión que nadie validó, y produciría un CAC con pinta de correcto y mal.
 */
const CRUCE_NOTE =
  'PARA CRUZAR CON FINZEN: el gasto de acá se une con acquisition.by_source[] de get_kpis por el NOMBRE de campaña ' +
  'contra utm_campaign. NADIE confirmó todavía que esos nombres coincidan. Antes de afirmar un CAC combinado, ' +
  'compara los nombres y di explícitamente si unieron o no. Si no unen, di "no puedo cruzarlo" — nunca estimes el CAC a ojo.';

const MONEDA_NOTE =
  'OJO con la moneda y la zona horaria: los importes están en la moneda de la CUENTA de Meta (mira account.currency, no asumas USD) ' +
  'y las fechas son días de la zona horaria de la cuenta, que puede no ser la de FinZen. Si difieren, el "ayer" de Meta no es el mismo día.';

const ESTADO_NOTE =
  'OJO con status vs effective_status: status es lo que se pidió, effective_status es lo que Meta realmente aplica. ' +
  'Una campaña con status ACTIVE y effective_status CAMPAIGN_PAUSED NO está gastando. Al reportar, manda effective_status.';

/** Presupuestos: Graph los da en unidades menores (centavos). 1500 => 15.00. */
function aMoneda(menores: number | null): number | null {
  return menores === null ? null : menores / 100;
}

/** Traduce la falta de credenciales a algo que el modelo pueda decirle al socio. */
function verificarConfig(): void {
  if (!config.meta.systemToken || !config.meta.adAccountId) {
    throw new Error(
      'La integración con Meta todavía no está configurada (faltan META_SYSTEM_TOKEN y/o META_AD_ACCOUNT_ID). ' +
        'NO reintentes: dile al socio que las credenciales de Meta las tiene que cargar FinZen en Railway.',
    );
  }
}

/** Los errores del cliente ya vienen redactados; el resto se pasa tal cual. */
function comoErrorDeTool(e: unknown): never {
  if (e instanceof MetaApiError) throw new Error(e.message);
  throw e;
}

export const getMetaCampaignsTool: KaizenTool = {
  name: 'get_meta_campaigns',
  ambito: 'marketing',
  description:
    'Lista las campañas publicitarias de la cuenta de Meta (Facebook/Instagram) de FinZen: nombre, estado, objetivo y presupuesto. ' +
    'Úsala para saber qué publicidad pagada está corriendo antes de hablar de adquisición pagada o de proponer algo relacionado. ' +
    'IMPORTANTE: status es lo que se pidió y effective_status es lo que Meta aplica — una campaña ACTIVE con effective_status CAMPAIGN_PAUSED no gasta. ' +
    'Los presupuestos ya vienen convertidos a unidades enteras de la moneda de la cuenta (no centavos). ' +
    'Esta tool SOLO LEE: Kaizen no puede crear ni activar campañas en Meta.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Cuántas campañas traer como máximo (opcional, default 50, tope 100)' },
    },
  },
  async execute(input) {
    verificarConfig();
    const limite = Math.min(Math.max(Number(input.limit) || 50, 1), 100);

    try {
      const [account, campanas] = await Promise.all([getAccount(), getCampaigns(limite)]);

      const payload = {
        account: { id: account.id, name: account.name, currency: account.currency, timezone: account.timezone_name },
        campaigns: campanas.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          effective_status: c.effective_status,
          gastando: c.effective_status === 'ACTIVE',
          objective: c.objective,
          daily_budget: aMoneda(c.daily_budget),
          lifetime_budget: aMoneda(c.lifetime_budget),
          created_time: c.created_time,
          stop_time: c.stop_time,
        })),
      };

      return [ESTADO_NOTE, MONEDA_NOTE, JSON.stringify(payload)].join('\n');
    } catch (e) {
      comoErrorDeTool(e);
    }
  },
};

export const getMetaSpendTool: KaizenTool = {
  name: 'get_meta_spend',
  ambito: 'marketing',
  description:
    'Gasto y rendimiento de las campañas de Meta en un rango de fechas: spend, impresiones, clics, CPM, CPC y CTR por campaña. ' +
    'LLÁMALA SIEMPRE antes de afirmar cuánto se gastó en publicidad; nunca respondas cifras de gasto de memoria. ' +
    'Para responder "¿a qué CAC?" hace falta cruzar esto con acquisition.by_source[] de get_kpis, uniendo por nombre de campaña contra utm_campaign — ' +
    'y ese cruce todavía NO está validado, así que verifica que los nombres coincidan antes de dar un CAC combinado. ' +
    'Los importes están en la moneda de la cuenta de Meta y las fechas en su zona horaria.',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional; default: hace 30 días)' },
      to: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional; default: hoy)' },
    },
  },
  async execute(input) {
    verificarConfig();

    const from = input.from as string | undefined;
    const to = input.to as string | undefined;
    for (const [k, v] of Object.entries({ from, to })) {
      if (v !== undefined && !DATE_RE.test(v)) {
        throw new Error(`El parámetro "${k}" debe tener formato YYYY-MM-DD (recibí "${v}"). Corrige la fecha y vuelve a llamar.`);
      }
    }
    if (from && to && from > to) {
      throw new Error(`El rango es inválido: "from" (${from}) es posterior a "to" (${to}). Invierte las fechas.`);
    }

    const hoy = new Date();
    const desde = from ?? new Date(hoy.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const hasta = to ?? hoy.toISOString().slice(0, 10);

    try {
      const [account, filas] = await Promise.all([getAccount(), getSpend(desde, hasta)]);

      // El total se calcula acá y no se le pide al modelo que sume: sumar a
      // ojo una lista de decimales es justo el tipo de error silencioso que
      // termina en un reporte con una cifra que nadie puede reproducir.
      const total = filas.reduce((acc, r) => acc + r.spend, 0);

      const payload = {
        window: { from: desde, to: hasta, timezone: account.timezone_name },
        currency: account.currency,
        total_spend: Number(total.toFixed(2)),
        campaigns: filas,
      };

      const vacio = filas.length === 0
        ? 'No hubo gasto en esa ventana. Eso puede significar que no había campañas activas o que la ventana está fuera del historial de la cuenta: dilo así, no lo interpretes como que la publicidad no funcionó.'
        : '';

      return [MONEDA_NOTE, CRUCE_NOTE, vacio, JSON.stringify(payload)].filter(Boolean).join('\n');
    } catch (e) {
      comoErrorDeTool(e);
    }
  },
};
