import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { WeekMode } from '../types';
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

  // Misma función que el job que corre al arrancar y cada 6h. Sin esto, un
  // cambio en el Cerebro puede tardar hasta 6 horas en verse y la única forma
  // de apurarlo es reiniciar el server.
  const handleReindex = async () => {
    setReindexing(true);
    setReindexError(null);
    setReindexResult(null);
    try {
      const r = await api.reindexCerebro();
      setReindexResult(
        `Listo — ${r.updated} actualizados, ${r.unchanged} sin cambios, ${r.omitted} omitidos, ${r.deleted} borrados.`,
      );
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
          Definí qué semana cubre el resumen semanal automático de Kaizen y cuándo se genera.
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
                Genera el reporte de la semana <strong>ahora mismo</strong>, sin esperar al día programado. La semana a evaluar depende de si elegiste los últimos 7 días o la semana de calendario, así que guardá la configuración primero si la cambiaste.
              </p>
              {runNowResult && <p className="config-run-now-ok">{runNowResult}</p>}
              {runNowError && <p className="config-error">{runNowError}</p>}
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
