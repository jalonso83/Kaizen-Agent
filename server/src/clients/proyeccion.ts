import { audit } from '../services/audit';

// ─────────────────────────────────────────────────────────────────────────
// Lista blanca de campos sobre las respuestas de la FinZen Agent API.
//
// Por qué existe (auditoría de guardarraíles del 2026-08-07, hallazgo abierto
// de la regla dura 4): el cliente devolvía la respuesta de FinZen TAL CUAL y
// las tools la reenviaban con JSON.stringify. O sea que la garantía de "Kaizen
// nunca ve datos personales" no era de Kaizen: era de FinZen. El día que
// alguien agregue un campo al endpoint —un email de ejemplo, una lista de ids,
// un nombre— Kaizen se lo pasa al modelo, al chat y potencialmente a un Doc de
// Drive, sin que nada lo note.
//
// Acá se invierte el default: pasa lo que el contrato del PRD §4 declara, se
// descarta todo lo demás. Un campo nuevo legítimo se agrega en un PR de una
// línea; un campo nuevo inesperado no llega al modelo.
//
// **El descarte NUNCA es silencioso.** Es el patrón que ya mordió cinco veces
// en este proyecto (el smoke test que solo listaba, el resumen semanal que
// reportaba éxito sin escribir, el botón de reindexar, el indexador tragándose
// archivos, los PDF sin texto): cada ruta descartada se audita y se escribe en
// los logs del server. Si FinZen cambia el contrato, se ve — que es justo lo
// que hoy no pasaría.
// ─────────────────────────────────────────────────────────────────────────

/**
 * La forma permitida de una respuesta:
 *  - `true`   — escalar (string, number, boolean o null). Un objeto acá se descarta.
 *  - `'mapa'` — objeto de claves libres con valores escalares (plan_distribution,
 *               params_used): las claves no se pueden listar de antemano.
 *  - `Forma`  — objeto anidado, se recorre clave por clave.
 *  - `[Forma]`— arreglo de objetos, cada elemento se recorre con esa forma.
 */
export type Forma = { [clave: string]: true | 'mapa' | Forma | [Forma] };

function esEscalar(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Copia `valor` dejando solo lo que `forma` declara. Las rutas descartadas se
 * acumulan en `descartes` (notación con puntos; los arreglos usan `[]` porque
 * el índice no aporta: si sobra un campo, sobra en todos los elementos).
 *
 * Una clave declarada que NO viene en la respuesta simplemente no aparece — no
 * se rellena con null. `engagement.wau` es exactamente ese caso: está en el
 * contrato como opcional y Kaizen no debe inventarlo (PRD §4.2, regla dura 1).
 */
export function proyectar(valor: unknown, forma: Forma, ruta = '', descartes: string[] = []): unknown {
  if (!esObjetoPlano(valor)) return valor;

  const salida: Record<string, unknown> = {};
  for (const [clave, v] of Object.entries(valor)) {
    const rutaHija = ruta ? `${ruta}.${clave}` : clave;
    const esperado = forma[clave];

    if (esperado === undefined) {
      descartes.push(rutaHija);
      continue;
    }

    if (esperado === true) {
      if (esEscalar(v)) salida[clave] = v;
      else descartes.push(`${rutaHija} (se esperaba un escalar)`);
      continue;
    }

    if (esperado === 'mapa') {
      if (!esObjetoPlano(v)) {
        descartes.push(`${rutaHija} (se esperaba un objeto)`);
        continue;
      }
      const mapa: Record<string, unknown> = {};
      for (const [k, mv] of Object.entries(v)) {
        if (esEscalar(mv)) mapa[k] = mv;
        else descartes.push(`${rutaHija}.${k} (se esperaba un escalar)`);
      }
      salida[clave] = mapa;
      continue;
    }

    if (Array.isArray(esperado)) {
      if (!Array.isArray(v)) {
        descartes.push(`${rutaHija} (se esperaba un arreglo)`);
        continue;
      }
      salida[clave] = v.map((item) => proyectar(item, esperado[0], `${rutaHija}[]`, descartes));
      continue;
    }

    if (!esObjetoPlano(v)) {
      descartes.push(`${rutaHija} (se esperaba un objeto)`);
      continue;
    }
    salida[clave] = proyectar(v, esperado, rutaHija, descartes);
  }

  return salida;
}

// ── Las formas, según el contrato del PRD §4 ──────────────────────────────

export const FORMA_KPIS: Forma = {
  period: { from: true, to: true },
  users: { total: true, new_registrations: true, registration_change_pct: true, activated: true },
  // wau es opcional (PRD §4.2, pendiente de que FinZen lo confirme): si no
  // viene, no aparece; si viene, pasa.
  engagement: { dau: true, wau: true, mau: true, retention_d1_pct: true, retention_d7_pct: true, retention_d30_pct: true },
  revenue: {
    mrr_usd: true,
    plan_distribution: 'mapa',
    churn_rate_pct: true,
    free_to_paid_rate_pct: true,
    trials: { active: true, started: true, conversion_rate_pct: true },
  },
  acquisition: {
    totals: { visitors: true, leads: true, registrations: true, subscriptions: true },
    by_source: [
      {
        source: true, campaign: true, visitors: true, leads: true, registrations: true,
        subscriptions: true, revenue_usd: true, cost_usd: true, conversion_rate_pct: true, cac_usd: true,
      },
    ],
  },
  campaigns: [
    {
      id: true, title: true, surface: true, sent_at: true, holdout_pct: true,
      exposed: true, holdout: true, impressions: true, clicks: true,
      exposed_tx_rate_pct: true, holdout_tx_rate_pct: true, lift_pts: true,
    },
  ],
};

export const FORMA_SEGMENTOS: Forma = {
  segments: [
    {
      slug: true,
      name: true,
      description: true,
      params: [{ name: true, type: true, required: true, default: true, description: true }],
    },
  ],
};

export const FORMA_EVALUACION: Forma = {
  slug: true,
  count: true,
  opted_out: true,
  params_used: 'mapa',
  evaluated_at: true,
};

export const FORMA_ADQUISICION: Forma = {
  window: { start: true, end: true, timezone: true },
  rows: [{ source: true, campaign: true, medium: true, visitors: true, leads: true, leads_unicos: true }],
};

export const FORMA_BORRADOR: Forma = { id: true, status: true, message: true };

// ── Reporte de descartes ──────────────────────────────────────────────────

/**
 * Una ruta se reporta UNA vez por vida del proceso. Sin esto, un campo nuevo en
 * `/kpis` escribiría una fila de auditoría por cada llamada y el hallazgo —que
 * es lo valioso— quedaría enterrado en su propio ruido.
 */
const yaReportadas = new Set<string>();

export function reportarDescartes(endpoint: string, descartes: string[]): void {
  const nuevas = [...new Set(descartes)].filter((d) => !yaReportadas.has(`${endpoint} ${d}`));
  if (nuevas.length === 0) return;
  for (const d of nuevas) yaReportadas.add(`${endpoint} ${d}`);

  const detalle = nuevas.join(', ');
  console.warn(
    `[finzen] Campos fuera del contrato descartados en ${endpoint}: ${detalle}. ` +
      `Si son legítimos, agrégalos a la forma en clients/proyeccion.ts; si no, avisa a FinZen.`,
  );
  void audit.log({
    actor: 'system',
    action: 'finzen:campos-descartados',
    input: { endpoint, campos: nuevas },
    resultSummary: `Descartados por la lista blanca del contrato (PRD §4): ${detalle}`.slice(0, 2000),
  });
}

/** Proyecta y reporta de una sola pasada — lo que usa el cliente. */
export function proyectarRespuesta<T>(valor: unknown, forma: Forma, endpoint: string): T {
  const descartes: string[] = [];
  const limpio = proyectar(valor, forma, '', descartes);
  reportarDescartes(endpoint, descartes);
  return limpio as T;
}

/** Solo para las pruebas: el dedup es por vida del proceso. */
export function _resetReportados(): void {
  yaReportadas.clear();
}
