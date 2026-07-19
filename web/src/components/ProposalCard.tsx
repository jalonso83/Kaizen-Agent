import type { Proposal } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// La tarjeta de propuesta — DISENO_FASE1.md §10. El payload que se muestra
// es EXACTAMENTE el guardado en BD: el socio confirma lo que se va a enviar,
// no una versión distinta.
//
// Nota: los botones llaman a /api/proposals/:id/confirm y /reject, que
// todavía no existen en el server (el gate es la Fase 1 slice 2 — ver
// server/README.md §10). Hasta que esos endpoints existan, confirmar da 404;
// el componente queda listo para cuando se construyan.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<Proposal['status'], string> = {
  PROPOSED: 'Propuesta',
  CONFIRMED: 'Confirmada',
  EXECUTING: 'Creando borrador…',
  EXECUTED: 'Borrador en FinZen',
  REJECTED: 'Rechazada',
  SUPERSEDED: 'Reemplazada',
  UNKNOWN_OUTCOME: 'Resultado desconocido',
};

interface Props {
  proposal: Proposal;
  onConfirm: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
}

export function ProposalCard({ proposal, onConfirm, onReject }: Props) {
  const { payload } = proposal;
  const pending = proposal.status === 'PROPOSED';

  return (
    <div className={`proposal-card status-${proposal.status.toLowerCase()}`}>
      <div className="proposal-header">
        <span className="proposal-eyebrow">Propuesta de campaña</span>
        <span className="proposal-status-pill">{STATUS_LABEL[proposal.status]}</span>
      </div>

      <p className="proposal-title">{payload.title}</p>
      <p className="proposal-message">&ldquo;{payload.message}&rdquo;</p>

      <dl className="proposal-meta">
        <div>
          <dt>Segmento</dt>
          <dd>
            {payload.segment_slug}
            {proposal.segmentCount != null ? ` · ${proposal.segmentCount.toLocaleString('es-DO')} usuarios` : ''}
          </dd>
        </div>
        <div>
          <dt>Holdout</dt>
          <dd>{payload.holdout_pct ?? 10}%</dd>
        </div>
        <div>
          <dt>Superficie</dt>
          <dd>{payload.surface ?? 'push'}</dd>
        </div>
      </dl>

      <p className="proposal-rationale">{payload.rationale}</p>

      {proposal.status === 'EXECUTED' && (
        <p className="proposal-note">Queda pendiente de aprobación humana en el panel de FinZen.</p>
      )}
      {proposal.status === 'UNKNOWN_OUTCOME' && (
        <p className="proposal-note proposal-note-warning">
          No se pudo confirmar si el borrador se creó — verificar en el panel de FinZen antes de reintentar.
        </p>
      )}
      {proposal.error && <p className="proposal-note proposal-note-warning">{proposal.error}</p>}

      {pending && (
        <div className="proposal-actions">
          <button type="button" onClick={() => onReject(proposal.id)}>
            Rechazar
          </button>
          <button type="button" className="primary" onClick={() => onConfirm(proposal.id)}>
            Confirmar
          </button>
        </div>
      )}
    </div>
  );
}
