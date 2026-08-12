import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { WeekMode } from '../types';

const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// "1:00 AM" … "12:00 PM" … "11:00 PM" — el resumen siempre corre en punto.
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
  const sufijo = h < 12 ? 'AM' : 'PM';
  const doce = h % 12 === 0 ? 12 : h % 12;
  return `${doce}:00 ${sufijo}`;
});

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
              <label className="config-select-row">
                Empieza en:
                <select
                  value={weekStartDay}
                  onChange={(e) => setWeekStartDay(Number(e.target.value))}
                >
                  {DAY_LABELS.map((label, day) => (
                    <option key={day} value={day}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
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
                <label className="config-select-row">
                  Día:
                  <select value={cronDay} onChange={(e) => setCronDay(Number(e.target.value))}>
                    {DAY_LABELS.map((label, day) => (
                      <option key={day} value={day}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="config-select-row">
                  Hora:
                  <select value={cronHour} onChange={(e) => setCronHour(Number(e.target.value))}>
                    {HOUR_LABELS.map((label, hour) => (
                      <option key={hour} value={hour}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
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
