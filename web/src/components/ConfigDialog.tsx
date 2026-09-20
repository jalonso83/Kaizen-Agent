import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { ConversationSummary, WeekMode } from '../types';
import { Select } from './Select';

const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAY_OPTIONS = DAY_LABELS.map((label, value) => ({ value, label }));

// La hora se elige en dos listas cortas (1-12 y AM/PM) en vez de una sola de
// 24 combinaciones: se lee de un vistazo y ninguna de las dos necesita
// scrollearse mucho. No se usa un campo de texto porque el cron solo corre EN
// PUNTO (`0 <hora> * * <día>`): escribir "8:30" invitaría a minutos que no se
// pueden cumplir y habría que rechazarlos o ignorarlos en silencio.
const HOUR12_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
const MERIDIEM_OPTIONS = [
  { value: 0, label: 'AM' },
  { value: 1, label: 'PM' },
];

// Conversión entre la hora de 24h que guarda la BD (0-23, lo que espera el
// cron) y el par 12h + AM/PM que se muestra. El caso raro es el 12: las 12 AM
// son la hora 0 y las 12 PM son la 12, así que no se puede sumar 12 a secas.
function to12h(hour24: number): { hour12: number; meridiem: number } {
  return { hour12: hour24 % 12 === 0 ? 12 : hour24 % 12, meridiem: hour24 < 12 ? 0 : 1 };
}
function to24h(hour12: number, meridiem: number): number {
  const base = hour12 % 12; // 12 → 0
  return meridiem === 1 ? base + 12 : base;
}

interface Props {
  onClose: () => void;
}

// Apartado de Configuración (DISENO_FASE1.md §12 addendum). Define dos cosas
// INDEPENDIENTES, y por eso van en bloques separados en la UI:
//  - QUÉ semana se reporta: rolling (últimos 7 días) o calendario (semana
//    completa con día de inicio elegible).
//  - CUÁNDO corre: día y hora (RD). Hasta 2026-08-11 esto estaba fijo en el
//    código (lunes 8am); ahora lo elige el socio y el server reprograma el
//    cron al guardar.
// Se puede correr el lunes reportando miércoles→martes: son ejes distintos.
export function ConfigDialog({ onClose }: Props) {
  const [weekMode, setWeekMode] = useState<WeekMode>('calendar');
  const [weekStartDay, setWeekStartDay] = useState(1);
  const [cronDay, setCronDay] = useState(1);
  const [cronHour, setCronHour] = useState(8);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningNow, setRunningNow] = useState(false);
  const [runNowError, setRunNowError] = useState<string | null>(null);
  const [runNowResult, setRunNowResult] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexError, setReindexError] = useState<string | null>(null);
  const [reindexResult, setReindexResult] = useState<string | null>(null);
  // Campaña diaria (2026-09-20). Se guarda junto con el resumen semanal en el
  // mismo botón Guardar, pero es otra configuración (otro endpoint).
  const [dcEnabled, setDcEnabled] = useState(false);
  const [dcModo, setDcModo] = useState<'tarjeta' | 'directo'>('tarjeta');
  const [dcHour, setDcHour] = useState(9);
  const [dcConversationId, setDcConversationId] = useState<string | null>(null);
  const [dcRotacion, setDcRotacion] = useState(7);
  const [dcConvBorrada, setDcConvBorrada] = useState(false);
  const [conversaciones, setConversaciones] = useState<ConversationSummary[]>([]);
  const [dcRunning, setDcRunning] = useState(false);
  const [dcRunError, setDcRunError] = useState<string | null>(null);
  const [dcRunResult, setDcRunResult] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api
      .getWeeklySummaryConfig()
      .then((cfg) => {
        setWeekMode(cfg.weekMode);
        setWeekStartDay(cfg.weekStartDay);
        setCronDay(cfg.cronDay);
        setCronHour(cfg.cronHour);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar la configuración.'))
      .finally(() => setLoading(false));
    api
      .getDailyCampaignConfig()
      .then((cfg) => {
        setDcEnabled(cfg.enabled);
        setDcModo(cfg.modo);
        setDcHour(cfg.cronHour);
        setDcRotacion(cfg.rotacionDias);
        // Si la conversación guardada ya no existe, se muestra vacío y se avisa.
        setDcConversationId(cfg.conversacion ? cfg.conversacion.id : null);
        setDcConvBorrada(Boolean(cfg.conversationId && !cfg.conversacion));
      })
      .catch(() => { /* sin la tabla (migración pendiente) el bloque queda con defaults */ });
    api.listConversations().then((r) => setConversaciones(r.conversations)).catch(() => {});
  }, []);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateWeeklySummaryConfig({ weekMode, weekStartDay, cronDay, cronHour });
      await api.updateDailyCampaignConfig({ enabled: dcEnabled, cronHour: dcHour, modo: dcModo, conversationId: dcConversationId, rotacionDias: dcRotacion });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar la configuración.');
      setSaving(false);
    }
  };

  // Corre la MISMA función que el cron de los lunes, ahora mismo — para no
  // tener que esperar a que llegue un lunes con el server despierto en ese
  // momento exacto solo para probar que el resumen funciona.
  const handleRunNow = async () => {
    setRunningNow(true);
    setRunNowError(null);
    setRunNowResult(null);
    try {
      const result = await api.runWeeklySummaryNow();
      setRunNowResult(`Listo — resumen de ${result.from} a ${result.to} guardado en 50-kaizen/ del Cerebro.`);
    } catch (err) {
      setRunNowError(err instanceof ApiError ? err.message : 'No se pudo correr el resumen.');
    } finally {
      setRunningNow(false);
    }
  };

  // Misma función que el cron diario. Corre aunque esté apagada (para
  // probarla antes de encender), pero sobre la conversación GUARDADA: si se
  // cambió acá y no se guardó, se avisa.
  const handleDailyRunNow = async () => {
    setDcRunning(true);
    setDcRunError(null);
    setDcRunResult(null);
    try {
      const r = await api.runDailyCampaignNow();
      const conv = conversaciones.find((c) => c.id === r.conversationId);
      setDcRunResult(
        r.borradorAutomatico
          ? `Listo — modo directo: el borrador de hoy ya está en FinZen (pendiente de aprobación en su panel). El racional quedó en "${conv?.title ?? r.conversationId}". Segmentos que podía elegir: ${r.permitidos.join(', ')}.`
          : `Listo — la propuesta de hoy quedó en "${conv?.title ?? r.conversationId}". Segmentos que podía elegir: ${r.permitidos.join(', ')}.`,
      );
    } catch (err) {
      setDcRunError(err instanceof ApiError ? err.message : 'No se pudo generar la campaña.');
    } finally {
      setDcRunning(false);
    }
  };

  // Misma función que el job que corre al arrancar y cada 6h. Sin esto, un
  // cambio en el Cerebro puede tardar hasta 6 horas en verse y la única forma
  // de apurarlo es reiniciar el server.
  const handleReindex = async () => {
    setReindexing(true);
    setReindexError(null);
    setReindexResult(null);
    try {
      const r = await api.reindexCerebro();
      const resumen = `${r.updated} actualizados, ${r.unchanged} sin cambios, ${r.omitted} omitidos, ${r.deleted} borrados.`;
      if (r.failed.length > 0) {
        // No es un "listo": esos archivos quedaron FUERA del índice, así que
        // Kaizen no los va a encontrar por más que existan en Drive.
        setReindexError(`Terminó, pero ${r.failed.length} archivo(s) no se pudieron leer y quedaron fuera del índice: ${r.failed.join(' · ')}. ${resumen}`);
      } else {
        setReindexResult(`Listo — ${resumen}`);
      }
    } catch (err) {
      setReindexError(err instanceof ApiError ? err.message : 'No se pudo reindexar el Cerebro.');
    } finally {
      setReindexing(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="config-title" className="dialog-title">
          Configuración
        </h2>
        <p className="dialog-message">
          El resumen semanal automático, la campaña diaria y el Cerebro.
        </p>

        {loading ? (
          <p className="config-loading">Cargando…</p>
        ) : (
          <div className="config-form">
            <label className="config-radio">
              <input
                type="radio"
                name="weekMode"
                checked={weekMode === 'calendar'}
                onChange={() => setWeekMode('calendar')}
              />
              <span>
                <strong>Semana calendario</strong> — una semana completa fija (ej. lunes a domingo)
              </span>
            </label>

            {weekMode === 'calendar' && (
              <div className="config-select-row">
                <Select label="Empieza en:" value={weekStartDay} options={DAY_OPTIONS} onChange={setWeekStartDay} />
              </div>
            )}

            <label className="config-radio">
              <input
                type="radio"
                name="weekMode"
                checked={weekMode === 'rolling'}
                onChange={() => setWeekMode('rolling')}
              />
              <span>
                <strong>Últimos 7 días</strong> — ventana móvil terminando el día que corre el resumen
              </span>
            </label>

            <div className="config-schedule">
              <p className="config-schedule-title">Cuándo se genera automáticamente</p>
              <div className="config-schedule-row">
                <Select label="Día:" value={cronDay} options={DAY_OPTIONS} onChange={setCronDay} />
                {/* cronHour (0-23) sigue siendo la única fuente de verdad; las dos
                    listas se derivan de él y lo recomponen. Guardar hora12 y
                    meridiano en estados aparte abriría la puerta a que queden
                    desincronizados con lo que se envía al server. */}
                <div className="select-field">
                  <span className="select-label">Hora:</span>
                  <div className="select-pair">
                    <Select
                      ariaLabel="Hora"
                      compact
                      value={to12h(cronHour).hour12}
                      options={HOUR12_OPTIONS}
                      onChange={(h12) => setCronHour(to24h(h12, to12h(cronHour).meridiem))}
                    />
                    <Select
                      ariaLabel="AM o PM"
                      compact
                      value={to12h(cronHour).meridiem}
                      options={MERIDIEM_OPTIONS}
                      onChange={(m) => setCronHour(to24h(to12h(cronHour).hour12, m))}
                    />
                  </div>
                </div>
              </div>
              <p className="config-schedule-hint">
                Horario UTC-4. Es cuándo <em>corre</em> el resumen, no qué semana reporta. Eso lo define la opción de arriba. Si el server está apagado a esa hora, esa semana no se genera.
              </p>
            </div>

            <div className="config-run-now">
              <button type="button" className="dialog-cancel" onClick={handleRunNow} disabled={runningNow || saving}>
                {runningNow ? 'Generando…' : 'Generar reporte'}
              </button>
              <p className="config-run-now-hint">
                Genera el reporte de la semana <strong>ahora mismo</strong>, sin esperar al día programado. La semana a evaluar depende de si elegiste los últimos 7 días o la semana de calendario, así que guarda la configuración primero si la cambiaste.
              </p>
              {runNowResult && <p className="config-run-now-ok">{runNowResult}</p>}
              {runNowError && <p className="config-error">{runNowError}</p>}
            </div>

            <div className="config-schedule">
              <p className="config-schedule-title">Campaña diaria</p>
              <label className="config-check">
                <input type="checkbox" checked={dcEnabled} onChange={(e) => setDcEnabled(e.target.checked)} />
                <span>
                  <strong>Proponer una campaña cada día</strong> — Kaizen elige una audiencia distinta cada día y deja la tarjeta en la conversación elegida. Vos la confirmás o rechazás desde ahí; nada sale a FinZen sin ese clic.
                </span>
              </label>
              <div className="config-schedule-row">
                <div className="select-field">
                  <span className="select-label">Hora:</span>
                  <div className="select-pair">
                    <Select ariaLabel="Hora de la campaña diaria" compact value={to12h(dcHour).hour12} options={HOUR12_OPTIONS} onChange={(h12) => setDcHour(to24h(h12, to12h(dcHour).meridiem))} />
                    <Select ariaLabel="AM o PM" compact value={to12h(dcHour).meridiem} options={MERIDIEM_OPTIONS} onChange={(m) => setDcHour(to24h(to12h(dcHour).hour12, m))} />
                  </div>
                </div>
                <Select
                  label="Sin repetir audiencia por:"
                  value={dcRotacion}
                  options={[3, 5, 7, 10, 14].map((d) => ({ value: d, label: `${d} días` }))}
                  onChange={setDcRotacion}
                />
              </div>
              <label className="config-radio">
                <input type="radio" name="dcModo" checked={dcModo === 'tarjeta'} onChange={() => setDcModo('tarjeta')} />
                <span>
                  <strong>Mandar la tarjeta para aprobar</strong> — la propuesta espera Confirmar o Rechazar en el chat elegido (también desde Auditoría).
                </span>
              </label>
              <label className="config-radio">
                <input type="radio" name="dcModo" checked={dcModo === 'directo'} onChange={() => setDcModo('directo')} />
                <span>
                  <strong>Mandar directo al panel de FinZen</strong> — sin tarjeta: Kaizen crea el borrador en FinZen, donde igual lo aprueba un humano antes de enviarse. Es una puerta menos; Auditoría lo marca como automático.
                </span>
              </label>
              {dcModo === 'tarjeta' && (
                <div className="config-schedule-row">
                  <div className="select-field" style={{ flex: 1 }}>
                    <span className="select-label">Conversación donde cae la tarjeta:</span>
                    <select
                      className="config-native-select"
                      value={dcConversationId ?? ''}
                      onChange={(e) => { setDcConversationId(e.target.value || null); setDcConvBorrada(false); }}
                    >
                      <option value="">— elegir —</option>
                      <option value="__nueva__">+ Nueva conversación (Kaizen la crea: "Campañas diarias")</option>
                      {conversaciones.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {dcConvBorrada && <p className="config-error">La conversación que estaba elegida ya no existe. Elegí otra o creá una nueva.</p>}
              <p className="config-schedule-hint">
                Horario UTC-4. {dcModo === 'tarjeta'
                  ? 'Tiene que ser una conversación tuya: la tarjeta la ve quien es dueño del chat, y ahí queda siempre hasta que la cambies. Si esa conversación está en uso justo a esa hora, ese día se omite (queda en Auditoría).'
                  : 'En modo directo Kaizen trabaja en una conversación propia ("Campañas diarias (automático)") que crea sola si no existe; ahí queda el racional de cada borrador.'}
              </p>
              <div className="config-run-now">
                <button type="button" className="dialog-cancel" onClick={handleDailyRunNow} disabled={dcRunning || saving}>
                  {dcRunning ? 'Generando…' : 'Generar campaña ahora'}
                </button>
                <p className="config-run-now-hint">
                  Corre la campaña diaria <strong>ahora</strong> sobre la conversación guardada, esté encendida o no. Guardá primero si cambiaste la conversación. Tarda un minuto: Kaizen lee el Cerebro, evalúa segmentos y arma la tarjeta.
                </p>
                {dcRunResult && <p className="config-run-now-ok">{dcRunResult}</p>}
                {dcRunError && <p className="config-error">{dcRunError}</p>}
              </div>
            </div>

            <div className="config-run-now">
              <button type="button" className="dialog-cancel" onClick={handleReindex} disabled={reindexing || saving}>
                {reindexing ? 'Reindexando…' : 'Reindexar el Cerebro'}
              </button>
              <p className="config-run-now-hint">
                Vuelve a leer el Cerebro de Drive ahora mismo. Kaizen busca sobre una copia local que se actualiza al arrancar y cada 6 horas, así que un documento editado recién puede tardar en verse. Los omitidos son los PDF, que esta versión no indexa.
              </p>
              {reindexResult && <p className="config-run-now-ok">{reindexResult}</p>}
              {reindexError && <p className="config-error">{reindexError}</p>}
            </div>
          </div>
        )}

        {error && <p className="config-error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="dialog-cancel" onClick={onClose} ref={cancelRef}>
            Cancelar
          </button>
          <button type="button" className="dialog-confirm" onClick={handleSave} disabled={loading || saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
