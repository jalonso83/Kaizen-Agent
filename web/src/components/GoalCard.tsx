import { useState } from 'react';
import type { Goal } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

// ─────────────────────────────────────────────────────────────────────────
// La tarjeta de META — misma mecánica que ProposalCard: el estado ACTIVE lo
// escribe SOLO el endpoint HTTP de este botón (routes/goals.ts), nunca el
// agente. Kaizen propone; el socio decide.
//
// Cuando la meta REEMPLAZA a otra, la tarjeta muestra el antes → después y el
// botón pide una confirmación extra: cambiar de meta borra el hilo de
// experimentación que venía corriendo, y es la clase de cosa que uno no quiere
// hacer de un clic distraído.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<Goal['status'], string> = {
  PROPOSED: 'Meta propuesta',
  ACTIVE: 'Meta vigente',
  ACHIEVED: 'Meta lograda',
  REJECTED: 'Rechazada',
  SUPERSEDED: 'Reemplazada',
};

/** "lift ≥ 3 pts" */
export function resumenMeta(g: Pick<Goal, 'metricLabel' | 'direction' | 'target' | 'unit'>): string {
  return `${g.metricLabel} ${g.direction === 'lte' ? '≤' : '≥'} ${g.target} ${g.unit}`.trim();
}

interface Props {
  goal: Goal;
  /** La meta que este cambio reemplazaría, si aplica. */
  reemplaza?: Goal;
  onConfirm: (goalId: string) => void;
  onReject: (goalId: string) => void;
}

export function GoalCard({ goal, reemplaza, onConfirm, onReject }: Props) {
  const [confirmandoCambio, setConfirmandoCambio] = useState(false);
  const pendiente = goal.status === 'PROPOSED';
  const esCambio = Boolean(goal.replacesGoalId);

  return (
    <div className={`goal-card status-${goal.status.toLowerCase()}`}>
      <div className="goal-header">
        <span className="goal-eyebrow">{esCambio ? 'Cambio de meta' : 'Meta de la campaña'}</span>
        <span className="goal-status-pill">{STATUS_LABEL[goal.status]}</span>
      </div>

      {esCambio && reemplaza && (
        <p className="goal-diff">
          <span className="goal-diff-antes">{resumenMeta(reemplaza)}</span>
          <span className="goal-diff-flecha">→</span>
          <span className="goal-diff-despues">{resumenMeta(goal)}</span>
        </p>
      )}

      <p className="goal-target">
        <span className="goal-metric">{goal.metricLabel}</span>
        <span className="goal-number">
          {goal.direction === 'lte' ? '≤' : '≥'} {goal.target.toLocaleString('es-DO')} {goal.unit}
        </span>
      </p>

      <p className="goal-rationale">{goal.rationale}</p>

      {goal.status === 'ACTIVE' && (
        <p className="goal-note">
          Kaizen va a seguir proponiendo campañas hacia esta meta hasta lograrla. No puede cambiarla por su cuenta:
          si querés otra métrica u otro número, pedíselo y te va a pedir confirmación.
        </p>
      )}
      {goal.status === 'ACHIEVED' && goal.achievedValue != null && (
        <p className="goal-note goal-note-ok">
          Lograda con {goal.achievedValue.toLocaleString('es-DO')} {goal.unit}
          {goal.achievedNote ? ` · ${goal.achievedNote}` : ''}
        </p>
      )}
      {goal.status === 'SUPERSEDED' && (
        <p className="goal-note">Reemplazada por una meta posterior que el socio confirmó.</p>
      )}

      {pendiente && (
        <div className="goal-actions">
          <button type="button" onClick={() => onReject(goal.id)}>
            Rechazar
          </button>
          <button
            type="button"
            className="primary"
            // Un cambio de meta pasa por un segundo "¿estás seguro?"; una meta
            // nueva (no hay nada que perder) se confirma directo.
            onClick={() => (esCambio ? setConfirmandoCambio(true) : onConfirm(goal.id))}
          >
            {esCambio ? 'Cambiar la meta' : 'Confirmar meta'}
          </button>
        </div>
      )}

      {confirmandoCambio && (
        <ConfirmDialog
          title="¿Seguro que querés cambiar la meta?"
          message={
            reemplaza
              ? `Se deja de perseguir "${resumenMeta(reemplaza)}" y se pasa a "${resumenMeta(goal)}". ` +
                'La meta anterior queda como reemplazada aunque no se haya logrado.'
              : `La meta pasa a ser "${resumenMeta(goal)}".`
          }
          confirmLabel="Sí, cambiar"
          cancelLabel="No, seguir con la actual"
          danger={false}
          onConfirm={() => {
            setConfirmandoCambio(false);
            onConfirm(goal.id);
          }}
          onCancel={() => setConfirmandoCambio(false)}
        />
      )}
    </div>
  );
}
