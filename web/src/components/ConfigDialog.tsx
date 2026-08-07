import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { WeekMode } from '../types';

const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

interface Props {
  onClose: () => void;
}

// Apartado de Configuración (DISENO_FASE1.md §12 addendum) — define qué
// semana usa el resumen semanal automático: rolling (últimos 7 días) o
// calendario (semana completa con día de inicio elegible, no necesariamente
// lunes). El cron en sí corre lunes 8am RD; esto solo define QUÉ ventana
// reporta, no cuándo corre.
export function ConfigDialog({ onClose }: Props) {
  const [weekMode, setWeekMode] = useState<WeekMode>('calendar');
  const [weekStartDay, setWeekStartDay] = useState(1);
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
      await api.updateWeeklySummaryConfig(weekMode, weekStartDay);
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
      setRunNowResult(`Listo — resumen de ${result.from} a ${result.to} guardado en Contenidos/assets.`);
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
          Definí qué semana usa el resumen semanal automático de Kaizen (corre los lunes).
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

            <div className="config-run-now">
              <button type="button" className="dialog-cancel" onClick={handleRunNow} disabled={runningNow || saving}>
                {runningNow ? 'Corriendo…' : 'Forzar corrida ahora'}
              </button>
              <p className="config-run-now-hint">
                Corre el resumen ya mismo con la configuración de arriba (guardala primero si la cambiaste) — no hace falta esperar al lunes. El resultado se guarda como Doc en Contenidos/assets de Drive, no aparece en este chat.
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
