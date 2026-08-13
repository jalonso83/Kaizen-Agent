import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { AuditEvent, AuditOverview } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// Pantalla de Auditoría — criterio 6 del PRD.
//
// El orden importa y es deliberado: primero SALUD (¿está todo corriendo?),
// después el GATE (¿alguna campaña llegó a FinZen sin confirmación?), y recién
// al final la actividad cruda. Las dos primeras responden preguntas; la tercera
// es la evidencia. Una tabla cronológica sola no serviría: el 95% de las filas
// son llamadas a herramientas y entierran lo único que hay que mirar.
// ─────────────────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  get_kpis: 'Consultó KPIs',
  get_campaign_results: 'Revisó resultados de campañas',
  list_segments: 'Listó segmentos',
  evaluate_segment: 'Evaluó un segmento',
  load_skill: 'Cargó su método',
  search_cerebro: 'Buscó en el Cerebro',
  save_content_draft: 'Guardó contenido',
  save_cerebro_note: 'Guardó una nota en el Cerebro',
  list_cerebro_folders: 'Listó carpetas del Cerebro',
  propose_campaign: 'Preparó una propuesta',
  create_campaign_draft: 'Creó el borrador en FinZen',
  get_message_type_performance: 'Revisó qué tipo de mensaje funcionó',
};

const ACTION_LABELS: Record<string, string> = {
  login: 'Inició sesión',
  logout: 'Cerró sesión',
  'proposal:confirmed': 'Confirmó una propuesta',
  'proposal:rejected': 'Rechazó una propuesta',
  'gate:denied': 'Intento bloqueado por el gate',
  'run:error': 'Falló el turno del agente',
  'weekly-summary:done': 'Resumen semanal generado',
  'weekly-summary:error': 'Falló el resumen semanal',
  'config:weekly-summary-updated': 'Cambió la configuración del resumen',
  'config:weekly-summary-run-now': 'Generó el reporte a mano',
  'config:cerebro-reindex': 'Reindexó el Cerebro',
};

function etiqueta(action: string): string {
  if (action.startsWith('tool:')) return TOOL_LABELS[action.slice(5)] ?? action.slice(5);
  return ACTION_LABELS[action] ?? action;
}

function quien(e: AuditEvent): string {
  if (e.actorName) return e.actorName;
  if (e.actor === 'agent') return 'Kaizen';
  if (e.actor === 'cron') return 'Automático';
  if (e.actor === 'system') return 'Sistema';
  // El log es append-only y sobrevive al socio: quedan filas de cuentas que ya
  // no existen. Mostrar el cuid crudo no le dice nada a nadie.
  if (e.actor.startsWith('partner:')) return 'Socio eliminado';
  return e.actor;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Qué significa cada código, en castellano. El número solo no le dice nada a un
// socio; "401" es "la key no sirve" y eso es lo accionable.
const HTTP_SENTIDO: Record<string, string> = {
  '400': 'petición inválida',
  '401': 'credenciales rechazadas',
  '403': 'sin permiso',
  '404': 'no encontrado',
  '429': 'límite de uso alcanzado',
  '500': 'error del servidor',
  '502': 'el servicio respondió mal',
  '503': 'servicio no disponible',
};

/**
 * Los errores de las APIs llegan al log tal cual vinieron, y algunos son un
 * volcado de JSON: `401 {"type":"error","error":{"message":"invalid x-api-key"}}`.
 * Ilegible de un vistazo. Esto extrae el mensaje que importa.
 *
 * NO se toca lo guardado: el log es la evidencia y tiene que quedar íntegro.
 * Esta traducción es solo de presentación, y el texto crudo sigue disponible en
 * el `title` de la fila.
 */
export function mensajeLegible(raw: string): string {
  const conStatus = raw.match(/^(\d{3})\s+([\s\S]+)$/);
  const status = conStatus ? conStatus[1] : null;
  const cuerpo = (conStatus ? conStatus[2] : raw).trim();

  let mensaje: string | null = null;
  if (cuerpo.startsWith('{') || cuerpo.startsWith('[')) {
    try {
      const json = JSON.parse(cuerpo) as Record<string, unknown>;
      const anidado = json.error as Record<string, unknown> | undefined;
      const candidato = anidado?.message ?? json.message;
      if (typeof candidato === 'string') mensaje = candidato;
    } catch {
      // No era JSON válido (p.ej. viene truncado a 2000 chars) — se deja crudo.
    }
  }

  if (!mensaje) return raw;
  const sentido = status ? HTTP_SENTIDO[status] : null;
  return sentido ? `${sentido} — ${mensaje}` : mensaje;
}

/**
 * El dato concreto detrás del evento, cuando existe: sin esto una fila dice
 * "cambió la configuración del resumen" y no A QUÉ la cambió, que es justo lo
 * que uno quiere saber al auditar.
 */
const hora12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

/** Campos de la config del resumen semanal, con cómo mostrarlos. */
const CAMPOS_CONFIG: Array<{ key: string; label: string; fmt: (v: unknown) => string }> = [
  { key: 'weekMode', label: 'Ventana', fmt: (v) => (v === 'rolling' ? 'últimos 7 días' : 'semana calendario') },
  { key: 'weekStartDay', label: 'La semana empieza', fmt: (v) => (typeof v === 'number' ? DIAS[v] : String(v)) },
  { key: 'cronDay', label: 'Corre el día', fmt: (v) => (typeof v === 'number' ? DIAS[v] : String(v)) },
  { key: 'cronHour', label: 'A la hora', fmt: (v) => (typeof v === 'number' ? hora12(v) : String(v)) },
];

export interface CambioConfig {
  label: string;
  antes: string | null;
  despues: string;
  cambio: boolean;
}

/**
 * Qué cambió en una edición de configuración. El log no guarda el estado
 * anterior, así que el "antes" se reconstruye del evento previo del mismo tipo
 * — que es exactamente para lo que sirve un registro cronológico. Si el previo
 * cayó fuera de la página cargada, se muestran solo los valores resultantes.
 */
export function cambiosConfig(actual: Record<string, unknown>, previo?: Record<string, unknown>): CambioConfig[] {
  return CAMPOS_CONFIG.filter((c) => actual[c.key] !== undefined).map((c) => {
    const hayPrevio = previo && previo[c.key] !== undefined;
    const cambio = Boolean(hayPrevio && previo![c.key] !== actual[c.key]);
    return {
      label: c.label,
      antes: cambio ? c.fmt(previo![c.key]) : null,
      despues: c.fmt(actual[c.key]),
      cambio,
    };
  });
}

/** Resumen de una línea al costado. Los cambios de config NO lo usan: van desplegables. */
function detalle(e: AuditEvent): string | null {
  if (['config:cerebro-reindex', 'config:weekly-summary-run-now', 'weekly-summary:done'].includes(e.action)) {
    return e.resultSummary;
  }
  return null;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const duracion = (ms: number | null) => (ms === null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** Eventos CONSECUTIVOS de la misma conversación, para plegar el ruido de las tools. */
interface Grupo {
  key: string;
  conversationId: string | null;
  titulo: string;
  eventos: AuditEvent[];
}

function agrupar(eventos: AuditEvent[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const e of eventos) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.conversationId === e.conversationId && e.conversationId !== null) {
      ultimo.eventos.push(e);
      continue;
    }
    grupos.push({
      key: e.id,
      conversationId: e.conversationId,
      titulo: e.conversationTitle ?? (e.conversationId ? 'Conversación' : 'Fuera de conversación'),
      eventos: [e],
    });
  }
  return grupos;
}

export function AuditPage() {
  const [overview, setOverview] = useState<AuditOverview | null>(null);
  const [eventos, setEventos] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nivel, setNivel] = useState<'important' | 'all'>('important');
  const [soloErrores, setSoloErrores] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const cargarEventos = useCallback(
    async (reset: boolean, desdeCursor?: string) => {
      const r = await api.getAuditEvents({ level: nivel, onlyErrors: soloErrores, cursor: desdeCursor });
      setEventos((prev) => (reset ? r.events : [...prev, ...r.events]));
      setCursor(r.nextCursor);
    },
    [nivel, soloErrores],
  );

  useEffect(() => {
    setCargando(true);
    setError(null);
    Promise.all([api.getAuditOverview().then(setOverview), cargarEventos(true)])
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar la auditoría.'))
      .finally(() => setCargando(false));
  }, [cargarEventos]);

  const alternar = (key: string) =>
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (cargando && !overview) return <div className="audit-loading">Cargando auditoría…</div>;

  const grupos = agrupar(eventos);

  // Para cada cambio de config, el cambio ANTERIOR del mismo tipo. La lista
  // viene de más nuevo a más viejo, así que el previo es el siguiente que
  // aparece con la misma acción.
  const previoPorId = new Map<string, AuditEvent>();
  const ultimoVisto = new Map<string, AuditEvent>();
  for (const e of eventos) {
    if (e.action !== 'config:weekly-summary-updated') continue;
    const yaVisto = ultimoVisto.get(e.action);
    if (yaVisto) previoPorId.set(yaVisto.id, e);
    ultimoVisto.set(e.action, e);
  }
  const sinConfirmacion = overview ? overview.gate.sinConfirmacion > 0 : false;

  return (
    <div className="audit-page">
      {error && <div className="banner-error">{error}</div>}

      {overview && (
        <>
          <section className="audit-health">
            <div className="audit-health-card">
              <span className="audit-health-label">Resumen semanal</span>
              {overview.health.resumenSemanal ? (
                <span className={overview.health.resumenSemanal.ok ? 'audit-ok' : 'audit-bad'}>
                  {overview.health.resumenSemanal.ok ? 'Corrió' : 'Falló'} · {fechaHora(overview.health.resumenSemanal.at)}
                </span>
              ) : (
                <span className="audit-muted">Todavía no corrió</span>
              )}
            </div>
            <div className="audit-health-card">
              <span className="audit-health-label">Indexado del Cerebro</span>
              {overview.health.indexado ? (
                <span className={overview.health.indexado.ok ? 'audit-ok' : 'audit-bad'}>
                  {overview.health.indexado.ok ? 'Al día' : 'Falló'} · {fechaHora(overview.health.indexado.at)}
                </span>
              ) : (
                <span className="audit-muted">Sin registro</span>
              )}
            </div>
            <div className="audit-health-card">
              <span className="audit-health-label">Errores (24 h)</span>
              <span className={overview.health.errores24h > 0 ? 'audit-bad' : 'audit-ok'}>
                {overview.health.errores24h}
              </span>
            </div>
          </section>

          <section className={`audit-gate${sinConfirmacion ? ' is-alert' : ''}`}>
            <h2 className="audit-gate-title">
              {sinConfirmacion
                ? `${overview.gate.sinConfirmacion} borrador(es) sin confirmación`
                : 'Ningún borrador sin confirmar'}
            </h2>
            <p className="audit-gate-sub">
              {overview.gate.borradoresCreados} borrador(es) creados en FinZen · {overview.gate.bloqueados} intento(s)
              bloqueados por el gate
            </p>

            {overview.gate.campanas.length === 0 ? (
              <p className="audit-muted audit-gate-empty">Todavía no se confirmó ninguna campaña.</p>
            ) : (
              <ul className="audit-gate-list">
                {overview.gate.campanas.map((c) => (
                  <li key={c.id} className={c.sinConfirmacion ? 'audit-gate-row is-alert' : 'audit-gate-row'}>
                    <span className="audit-gate-check">{c.sinConfirmacion ? '!' : '✓'}</span>
                    <span className="audit-gate-name">{c.titulo}</span>
                    <span className="audit-gate-meta">
                      {c.confirmadaPor && c.confirmedAt
                        ? `${c.confirmadaPor} ${hora(c.confirmedAt)}`
                        : 'sin confirmación'}
                      {c.executedAt ? ` → borrador ${hora(c.executedAt)}` : ` → ${c.status}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {overview.gate.denegados.length > 0 && (
              <ul className="audit-denied-list">
                {overview.gate.denegados.map((d) => (
                  <li key={d.id} className="audit-denied-row">
                    <span className="audit-denied-name">{d.resultSummary ?? 'Intento bloqueado'}</span>
                    <span className="audit-gate-meta">{fechaHora(d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="audit-activity">
        <div className="audit-activity-head">
          <h2 className="audit-gate-title">Actividad</h2>
          <div className="audit-filters">
            <div className="audit-toggle">
              <button
                type="button"
                className={nivel === 'important' ? 'is-active' : ''}
                onClick={() => setNivel('important')}
              >
                Importantes
              </button>
              <button type="button" className={nivel === 'all' ? 'is-active' : ''} onClick={() => setNivel('all')}>
                Todo
              </button>
            </div>
            <button
              type="button"
              className={soloErrores ? 'audit-chip is-active' : 'audit-chip'}
              onClick={() => setSoloErrores((v) => !v)}
            >
              Solo errores
            </button>
          </div>
        </div>

        {grupos.length === 0 && <p className="audit-muted">No hay eventos con estos filtros.</p>}

        <ul className="audit-groups">
          {grupos.map((g) => {
            const abierto = abiertos.has(g.key);
            const errores = g.eventos.filter((e) => e.isError).length;
            const propuestas = g.eventos.filter((e) => e.action === 'tool:propose_campaign').length;
            // Un grupo de un solo evento no gana nada con plegarse: se muestra
            // como una fila directa, con su etiqueta en vez de "1 acción".
            const suelto = g.eventos.length === 1;
            const e0 = g.eventos[0];
            // Un cambio de config suelto TAMBIÉN se despliega, para mostrar qué
            // se modificó en vez de un resumen apretado al costado.
            const cambios =
              suelto && e0.action === 'config:weekly-summary-updated'
                ? cambiosConfig((e0.input ?? {}) as Record<string, unknown>, previoPorId.get(e0.id)?.input as Record<string, unknown> | undefined)
                : null;
            const plegable = !suelto || Boolean(cambios?.length);

            return (
              <li key={g.key} className="audit-group">
                <button
                  type="button"
                  className={plegable ? 'audit-group-head is-plegable' : 'audit-group-head'}
                  onClick={() => plegable && alternar(g.key)}
                  aria-expanded={plegable ? abierto : undefined}
                >
                  {plegable ? (
                    <svg
                      className={abierto ? 'audit-caret is-open' : 'audit-caret'}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  ) : (
                    <span className="audit-caret-hueco" aria-hidden="true" />
                  )}
                  <span className="audit-group-title">
                    {suelto ? etiqueta(e0.action) : g.titulo}
                    {suelto && <span className="audit-muted"> · {quien(e0)}</span>}
                    {suelto && detalle(e0) && <span className="audit-detail"> · {detalle(e0)}</span>}
                  </span>
                  {errores > 0 && <span className="audit-bad">{errores} error(es)</span>}
                  {!suelto && (
                    <span className="audit-muted">
                      {g.eventos.length} acciones
                      {propuestas > 0 && ` · ${propuestas} propuesta${propuestas > 1 ? 's' : ''}`}
                    </span>
                  )}
                  <span className="audit-muted">{hora(e0.createdAt)}</span>
                </button>

                {/* title con el texto crudo: la traducción es de presentación,
                    pero al auditar hay que poder ver lo que realmente llegó. */}
                {suelto && e0.isError && e0.resultSummary && (
                  <p className="audit-error-detail" title={e0.resultSummary}>{mensajeLegible(e0.resultSummary)}</p>
                )}

                {cambios && abierto && (
                  <ul className="audit-cambios">
                    {cambios.map((c) => (
                      <li key={c.label} className={c.cambio ? 'audit-cambio is-changed' : 'audit-cambio'}>
                        <span className="audit-cambio-label">{c.label}</span>
                        {c.antes && (
                          <>
                            <span className="audit-cambio-antes">{c.antes}</span>
                            <span className="audit-cambio-flecha">→</span>
                          </>
                        )}
                        <span className="audit-cambio-despues">{c.despues}</span>
                      </li>
                    ))}
                    {cambios.every((c) => !c.cambio) && (
                      <li className="audit-muted audit-cambio-nota">
                        Sin el ajuste anterior a mano no se puede decir qué cambió; estos son los valores que quedaron.
                      </li>
                    )}
                  </ul>
                )}

                {!suelto && abierto && (
                  <ul className="audit-events">
                    {g.eventos.map((e) => (
                      <li key={e.id} className={e.isError ? 'audit-event is-error' : 'audit-event'}>
                        <span className="audit-event-time">{hora(e.createdAt)}</span>
                        <span className="audit-event-what">
                          {etiqueta(e.action)}
                          {detalle(e) && <span className="audit-detail"> · {detalle(e)}</span>}
                        </span>
                        <span className="audit-event-who">{quien(e)}</span>
                        <span className="audit-event-ms">{duracion(e.durationMs)}</span>
                        {e.isError && e.resultSummary && (
                          <p className="audit-error-detail" title={e.resultSummary}>{mensajeLegible(e.resultSummary)}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        {cursor && (
          <button type="button" className="audit-more" onClick={() => void cargarEventos(false, cursor)}>
            Cargar más
          </button>
        )}

        <p className="audit-immutable">
          Este registro no se puede editar ni borrar, ni siquiera desde la base de datos.
        </p>
      </section>
    </div>
  );
}
