import cron from 'node-cron';
import { audit } from '../services/audit';
import { analizarPerfil, cuentasGuardadas, faltaConfiguracion } from '../services/instagramAnalisis';

// ─────────────────────────────────────────────────────────────────────────
// Lectura diaria de Instagram → InstagramSnapshot (2026-09-12).
//
// El histórico del Dashboard se alimenta de dos lados: cada lectura real que
// hace un socio (o Kaizen) guarda el punto de hoy, y este cron lee TODAS las
// cuentas guardadas una vez al día para que la serie exista aunque nadie
// abra la pestaña en una semana. Sin esto, "cuánto creció el competidor este
// mes" dependería de que alguien lo haya mirado justo hace un mes.
//
// 2:00am RD (06:00 UTC): el día civil en RD ya cerró y el punto queda con la
// fecha de HOY, con la cuenta como amaneció. Si la migración no está aplicada
// o faltan credenciales, se omite con log — un cron que falla no debe tumbar
// el proceso ni reintentar en bucle contra el límite de Meta.
// ─────────────────────────────────────────────────────────────────────────

const CRON_SCHEDULE = '0 6 * * *'; // 06:00 UTC = 2:00am RD

export interface SnapshotRunResult {
  leidas: string[];
  fallidas: Array<{ usuario: string; motivo: string }>;
  omitido: string | null;
}

export async function runInstagramSnapshot(): Promise<SnapshotRunResult> {
  const falta = faltaConfiguracion();
  if (falta) {
    console.warn('[instagram-snapshot] Instagram no configurado — se omite la corrida.');
    return { leidas: [], fallidas: [], omitido: 'sin credenciales' };
  }

  const startedAt = Date.now();
  const out: SnapshotRunResult = { leidas: [], fallidas: [], omitido: null };

  let cuentas;
  try {
    cuentas = await cuentasGuardadas();
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.warn('[instagram-snapshot] No se pudieron leer las cuentas guardadas:', motivo);
    return { leidas: [], fallidas: [], omitido: motivo };
  }

  for (const cuenta of cuentas) {
    try {
      // forzar: la caché de 10 min no importa acá; el punto del día tiene que
      // ser una lectura de verdad de hoy.
      await analizarPerfil(cuenta, { forzar: true });
      out.leidas.push(cuenta.usuario);
    } catch (e) {
      out.fallidas.push({ usuario: cuenta.usuario, motivo: e instanceof Error ? e.message : String(e) });
    }
  }

  const resumen = `${out.leidas.length} leídas${out.fallidas.length ? `, ${out.fallidas.length} fallidas (${out.fallidas.map((f) => `@${f.usuario}: ${f.motivo}`).join('; ')})` : ''}`;
  console.log(`[instagram-snapshot] listo en ${Date.now() - startedAt}ms — ${resumen}.`);
  await audit.log({
    conversationId: null,
    actor: 'cron',
    action: 'cron:instagram-snapshot',
    resultSummary: resumen.slice(0, 2000),
    isError: out.fallidas.length > 0,
    durationMs: Date.now() - startedAt,
  });
  return out;
}

export function startInstagramSnapshotCron(): void {
  cron.schedule(CRON_SCHEDULE, () => void runInstagramSnapshot(), { timezone: 'UTC' });
}
