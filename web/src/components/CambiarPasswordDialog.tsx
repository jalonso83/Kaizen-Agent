import { useState } from 'react';
import { api, ApiError } from '../api';

// ─────────────────────────────────────────────────────────────────────────
// Cambiar la propia contraseña.
//
// Hace falta porque las contraseñas iniciales las pone un CEO/CTO al crear la
// cuenta (no hay envío de correos), así que sin esta pantalla esa persona
// quedaría sabiendo la contraseña de todo el equipo para siempre.
// ─────────────────────────────────────────────────────────────────────────

const MIN = 8;

export function CambiarPasswordDialog({ onClose }: { onClose: () => void }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState(false);

  const coinciden = nueva === repetir;
  const valido = actual.length > 0 && nueva.length >= MIN && coinciden && nueva !== actual;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await api.cambiarMiPassword(actual, nueva);
      setListo(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">Cambiar mi contraseña</h3>

        {listo ? (
          <>
            <p className="dialog-message">Listo. La próxima vez que entres usa la contraseña nueva.</p>
            <div className="dialog-actions">
              <button type="button" className="dialog-confirm" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={enviar}>
            <label className="usuarios-campo">
              <span>Contraseña actual</span>
              <input type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoFocus />
            </label>
            <label className="usuarios-campo">
              <span>Contraseña nueva</span>
              <input
                type="password"
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                placeholder={`Mínimo ${MIN} caracteres`}
              />
            </label>
            <label className="usuarios-campo">
              <span>Repetir la nueva</span>
              <input type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)} />
            </label>

            {repetir.length > 0 && !coinciden && <p className="config-error">Las dos contraseñas no coinciden.</p>}
            {error && <p className="config-error">{error}</p>}

            <div className="dialog-actions">
              <button type="button" className="dialog-cancel" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="dialog-confirm" disabled={!valido || guardando}>
                {guardando ? 'Guardando…' : 'Cambiar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
