import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { GoalCampaign, GoalHistory, GoalHistoryEntry } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// Pantalla de Metas.
//
// Lo que NO hace, a propósito: no muestra una barra de progreso. Para eso
// habría que medir la métrica ahora mismo, y las métricas de las metas son
// texto libre que Kaizen elige ('lift_pts', 'activation_rate', 'mrr_usd'): no
// hay garantía de que cada una corresponda a un campo de KPIs de FinZen. Una
// barra al 60% que en realidad nadie midió es peor que no tener barra.
//
// Lo que sí muestra es lo que está registrado y es verificable: qué meta rige,
// desde cuándo, quién la confirmó, qué campañas se propusieron bajo ella,
// cuáles llegaron de verdad a FinZen, y cómo terminó cada meta anterior.
// ─────────────────────────────────────────────────────────────────────────

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'long' });

/** Días entre dos fechas, redondeando hacia abajo. */
function dias(desde: string, hasta: string | null): number {
  const fin = hasta ? new Date(hasta).getTime() : Date.now();
  return Math.max(0, Math.floor((fin - new Date(desde).getTime()) / 86_400_000));
}

function duracion(g: GoalHistoryEntry): string | null {
  if (!g.confirmedAt) return null;
  const d = dias(g.confirmedAt, g.hasta);
  const cuenta = d === 0 ? 'menos de un día' : d === 1 ? '1 día' : `${d} días`;
  return g.status === 'ACTIVE' ? `${cuenta} vigente` : `duró ${cuenta}`;
}

const PILL: Record<string, string> = {
  ACTIVE: 'Vigente',
  ACHIEVED: 'Lograda',
  SUPERSEDED: 'Reemplazada',
  REJECTED: 'Rechazada',
  PROPOSED: 'Esperando confirmación',
};

/** Cómo terminó, en una frase. Es la línea que uno lee al revisar el historial. */
function desenlace(g: GoalHistoryEntry): string {
  switch (g.status) {
    case 'ACHIEVED': {
      const valor = g.achievedValue !== null ? `Lograda con ${g.achievedValue.toLocaleString('es-DO')} ${g.unit}`.trimEnd() : 'Lograda';
      return `${valor}${g.achievedAt ? ` el ${fecha(g.achievedAt)}` : ''}.`;
    }
    case 'SUPERSEDED':
      return 'Se cambió por otra meta antes de lograrse.';
    case 'REJECTED':
      return 'El socio la rechazó cuando Kaizen la propuso: nunca llegó a regir.';
    case 'PROPOSED':
      return 'Propuesta por Kaizen, todavía sin confirmar. Se confirma desde la tarjeta en el chat.';
    default:
      return '';
  }
}

function estadoCampana(c: GoalCampaign): string {
  if (c.llegoAFinzen) return c.executedAt ? `publicada el ${fecha(c.executedAt)}` : 'publicada';
  if (c.status === 'CONFIRMED') return 'confirmada, borrador sin crear';
  if (c.status === 'REJECTED') return 'rechazada';
  if (c.status === 'SUPERSEDED') return 'reemplazada por otra propuesta';
  return 'propuesta, sin confirmar';
}

function Campanas({ campanas }: { campanas: GoalCampaign[] }) {
  if (campanas.length === 0) {
    return <p className="metas-vacio">Todavía no se propuso ninguna campaña bajo esta meta.</p>;
  }
  return (
    <ul className="metas-campanas">
      {campanas.map((c) => (
        <li key={c.id} className={c.llegoAFinzen ? 'metas-campana is-publicada' : 'metas-campana'}>
          <span className="metas-campana-check">{c.llegoAFinzen ? '✓' : '·'}</span>
          <span className="metas-campana-titulo">{c.titulo}</span>
          {c.messageType && <span className="metas-campana-tipo">{c.messageType}</span>}
          <span className="metas-campana-estado">{estadoCampana(c)}</span>
        </li>
      ))}
    </ul>
  );
}

/** El conteo de campañas, dicho de forma que se entienda sin contar. */
function Conteo({ g }: { g: GoalHistoryEntry }) {
  return (
    <p className="metas-conteo">
      {g.propuestas === 0
        ? 'Sin campañas todavía'
        : `${g.propuestas} campaña${g.propuestas > 1 ? 's' : ''} propuesta${g.propuestas > 1 ? 's' : ''} · ${g.publicadas} publicada${g.publicadas === 1 ? '' : 's'} en FinZen`}
    </p>
  );
}

export function MetasPage() {
  const [data, setData] = useState<GoalHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  useEffect(() => {
    api
      .getGoalHistory()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar las metas.'));
  }, []);

  const alternar = (id: string) =>
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (error) return <div className="metas-page"><div className="banner-error">{error}</div></div>;
  if (!data) return <div className="audit-loading">Cargando metas…</div>;

  const vigente = data.metas.find((g) => g.status === 'ACTIVE') ?? null;
  const pendientes = data.metas.filter((g) => g.status === 'PROPOSED');
  const pasadas = data.metas.filter((g) => g.status !== 'ACTIVE' && g.status !== 'PROPOSED');

  return (
    <div className="metas-page">
      <section className="metas-vigente">
        <span className="goal-eyebrow">Meta vigente</span>
        {vigente ? (
          <>
            <p className="metas-resumen">{vigente.resumen}</p>
            <p className="metas-sub">
              {vigente.confirmadaPor && vigente.confirmedAt
                ? `Confirmada por ${vigente.confirmadaPor} el ${fecha(vigente.confirmedAt)}`
                : 'Sin registro de quién la confirmó'}
              {duracion(vigente) && ` · ${duracion(vigente)}`}
            </p>
            {vigente.reemplazaA && (
              <p className="goal-diff">
                <span className="goal-diff-antes">{vigente.reemplazaA}</span>
                <span className="goal-diff-flecha">→</span>
                <span className="goal-diff-despues">{vigente.resumen}</span>
              </p>
            )}
            <p className="metas-porque">{vigente.rationale}</p>
            <Conteo g={vigente} />
            <Campanas campanas={vigente.campanas} />
          </>
        ) : (
          <p className="metas-vacio">
            No hay ninguna meta vigente. Kaizen va a proponer una junto a la próxima campaña, y rige recién cuando
            la confirmás desde la tarjeta del chat.
          </p>
        )}
      </section>

      {pendientes.length > 0 && (
        <section className="metas-pendientes">
          <h2 className="metas-titulo">Esperando tu confirmación</h2>
          {pendientes.map((g) => (
            <div key={g.id} className="metas-pendiente">
              <p className="metas-pendiente-resumen">{g.resumen}</p>
              <p className="metas-porque">{g.rationale}</p>
              <p className="metas-sub">
                Propuesta el {fecha(g.createdAt)}
                {g.conversacion ? ` en "${g.conversacion.title}"` : ''} · se confirma desde la tarjeta del chat
              </p>
            </div>
          ))}
        </section>
      )}

      <section className="metas-historial">
        <h2 className="metas-titulo">Historial</h2>
        {pasadas.length === 0 ? (
          <p className="metas-vacio">Todavía no se cerró ninguna meta.</p>
        ) : (
          <ol className="metas-linea">
            {pasadas.map((g) => {
              const abierta = abiertas.has(g.id);
              return (
                <li key={g.id} className={`metas-hito status-${g.status.toLowerCase()}`}>
                  <button type="button" className="metas-hito-head" onClick={() => alternar(g.id)} aria-expanded={abierta}>
                    <svg
                      className={abierta ? 'audit-caret is-open' : 'audit-caret'}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                    <span className="metas-hito-resumen">{g.resumen}</span>
                    <span className="metas-hito-pill">{PILL[g.status] ?? g.status}</span>
                    <span className="metas-hito-meta">{duracion(g) ?? fecha(g.createdAt)}</span>
                  </button>
                  <p className="metas-hito-desenlace">{desenlace(g)}</p>
                  {abierta && (
                    <div className="metas-hito-cuerpo">
                      {g.reemplazaA && (
                        <p className="goal-diff">
                          <span className="goal-diff-antes">{g.reemplazaA}</span>
                          <span className="goal-diff-flecha">→</span>
                          <span className="goal-diff-despues">{g.resumen}</span>
                        </p>
                      )}
                      <p className="metas-porque">{g.rationale}</p>
                      {g.achievedNote && <p className="metas-sub">Medido con: {g.achievedNote}</p>}
                      <Conteo g={g} />
                      <Campanas campanas={g.campanas} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {data.campanasSinMeta > 0 && (
          <p className="metas-nota">
            Hay {data.campanasSinMeta} campaña(s) anteriores a que existieran las metas. No se les asigna ninguna
            porque no quedó registrado a cuál apuntaban, y deducirlo por fechas sería inventar el dato.
          </p>
        )}
      </section>
    </div>
  );
}
