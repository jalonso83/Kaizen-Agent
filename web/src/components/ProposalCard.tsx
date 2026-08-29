import type { Proposal } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// La tarjeta de propuesta — DISENO_FASE1.md §10. El payload que se muestra
// es EXACTAMENTE el guardado en BD: el socio confirma lo que se va a enviar,
// no una versión distinta. Confirmar/Rechazar llaman a
// /api/proposals/:id/{confirm,reject} (routes/proposals.ts, el gate §7).
// ─────────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<Proposal['status'], string> = {
  PROPOSED: 'Propuesta',
  CONFIRMED: 'Confirmada',
  EXECUTING: 'Creando borrador…',
  EXECUTED: 'Borrador en FinZen',
  REJECTED: 'Rechazada',
  SUPERSEDED: 'Reemplazada',
  UNKNOWN_OUTCOME: 'Resultado desconocido',
  EXPIRED: 'Confirmación expirada',
};

// Taxonomía de tipo de mensaje (server/src/agent/tools/campaigns.ts, MESSAGE_TYPES).
const MESSAGE_TYPE_LABEL: Record<string, string> = {
  urgencia: 'Urgencia',
  educativo: 'Educativo',
  incentivo: 'Incentivo',
  social_proof: 'Social proof',
  pregunta_directa: 'Pregunta directa',
  otro: 'Otro',
};

interface Props {
  proposal: Proposal;
  onConfirm: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
  /** Permiso 'campanas:confirmar'. Sin él la tarjeta se ve, pero no se decide. */
  puedeDecidir: boolean;
}

export function ProposalCard({ proposal, onConfirm, onReject, puedeDecidir }: Props) {
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
        {proposal.messageType && (
          <div>
            <dt>Tipo</dt>
            <dd>{MESSAGE_TYPE_LABEL[proposal.messageType] ?? proposal.messageType}</dd>
          </div>
        )}
      </dl>

      <p className="proposal-rationale">{payload.rationale}</p>
      {proposal.expectedMeasurement && (
        <p className="proposal-note">Se mide: {proposal.expectedMeasurement}</p>
      )}

      {proposal.status === 'EXECUTED' && (
        <p className="proposal-note">Queda pendiente de aprobación humana en el panel de FinZen.</p>
      )}
      {proposal.status === 'UNKNOWN_OUTCOME' && (
        <p className="proposal-note proposal-note-warning">
          No se pudo confirmar si el borrador se creó — verificar en el panel de FinZen antes de reintentar.
        </p>
      )}
      {proposal.status === 'EXPIRED' && (
        <p className="proposal-note proposal-note-warning">
          La confirmación expiró (más de 30 minutos) — propón de nuevo si sigue siendo una buena idea.
        </p>
      )}
      {proposal.error && <p className="proposal-note proposal-note-warning">{proposal.error}</p>}

      {/* Sin permiso se muestra la propuesta entera igual: poder LEER lo que
          Kaizen propone es justamente el punto de que otros usen el chat. Lo
          que no se puede es publicarla. Se dice por qué, en vez de esconder
          los botones y dejar a la persona buscando dónde confirmar. */}
      {pending && (puedeDecidir ? (
        <div className="proposal-actions">
          <button type="button" onClick={() => onReject(proposal.id)}>
            Rechazar
          </button>
          <button type="button" className="primary" onClick={() => onConfirm(proposal.id)}>
            Confirmar
          </button>
        </div>
      ) : (
        <p className="proposal-note">
          Esta campaña necesita que un CEO / CTO la confirme antes de llegar a FinZen.
        </p>
      ))}
    </div>
  );
}
