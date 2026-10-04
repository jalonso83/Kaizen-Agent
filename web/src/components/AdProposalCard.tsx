import type { AdProposal } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// La tarjeta de un anuncio en Meta (2026-10-04). Mismo lenguaje visual que
// ProposalCard. Lo que se muestra es EXACTAMENTE lo guardado en BD, y lo que
// se va a crear: presupuesto, duración, tope total, a quién y a dónde lleva.
// Confirmar llama a /api/ad-proposals/:id/confirm, que crea todo EN PAUSA.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<AdProposal['status'], string> = {
  PROPOSED: 'Propuesta',
  CONFIRMED: 'Confirmada',
  CREATING: 'Creando en Meta…',
  CREATED_PAUSED: 'Creada en pausa',
  ERROR: 'Meta la rechazó',
  REJECTED: 'Rechazada',
  SUPERSEDED: 'Reemplazada',
  EXPIRED: 'Vencida',
};

export const OBJETIVO_LABEL: Record<AdProposal['objetivo'], string> = {
  OUTCOME_TRAFFIC: 'Tráfico a la web',
  OUTCOME_ENGAGEMENT: 'Interacción con el post',
  OUTCOME_AWARENESS: 'Alcance',
};

function dinero(n: number, moneda: string): string {
  return `${n.toLocaleString('es-DO', { maximumFractionDigits: 2 })} ${moneda}`;
}

interface Props {
  propuesta: AdProposal;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  /** Permiso 'publicidad:confirmar'. */
  puedeDecidir: boolean;
  /** Mientras se crea en Meta (la respuesta tarda unos segundos). */
  ocupada?: boolean;
}

export function AdProposalCard({ propuesta: p, onConfirm, onReject, puedeDecidir, ocupada }: Props) {
  const pendiente = p.status === 'PROPOSED';
  const seg = p.segmentacion;

  return (
    <div className={`proposal-card status-${p.status.toLowerCase()}`}>
      <div className="proposal-header">
        <span className="proposal-eyebrow">{p.origen === 'programada' ? 'Anuncio en Meta · propuesta automática' : 'Anuncio en Meta'}</span>
        <span className="proposal-status-pill">{ocupada ? 'Creando en Meta…' : STATUS_LABEL[p.status]}</span>
      </div>

      <p className="proposal-title">
        Promocionar{' '}
        <a href={p.mediaPermalink} target="_blank" rel="noreferrer">
          este {p.mediaTipo === 'REELS' ? 'reel' : 'post'} de Instagram
        </a>
      </p>
      {p.mediaCaption && <p className="proposal-message">&ldquo;{p.mediaCaption}&rdquo;</p>}

      <dl className="proposal-meta">
        <div>
          <dt>Presupuesto</dt>
          <dd>
            {dinero(p.presupuestoDiario, p.moneda)}/día · {p.duracionDias} días
          </dd>
        </div>
        <div>
          <dt>Gasto máximo</dt>
          <dd>{dinero(p.presupuestoDiario * p.duracionDias, p.moneda)}</dd>
        </div>
        <div>
          <dt>Objetivo</dt>
          <dd>{OBJETIVO_LABEL[p.objetivo] ?? p.objetivo}</dd>
        </div>
        <div>
          <dt>A quién</dt>
          <dd>
            {seg.paises.join(', ')} · {seg.edadMin}–{seg.edadMax} años · solo Instagram
            {seg.categoriaFinanciera ? ' · categoría financiera' : ''}
          </dd>
        </div>
        <div>
          <dt>Nombre / UTM</dt>
          <dd>{p.nombre}</dd>
        </div>
      </dl>

      <p className="proposal-rationale">{p.racional}</p>
      <p className="proposal-note">Se mide: {p.medicion}</p>

      {pendiente && (
        <p className="proposal-note">
          Al confirmar, Kaizen crea la campaña en Meta <strong>en pausa</strong>: no gasta nada hasta que alguien la active en Ads Manager.
        </p>
      )}
      {p.status === 'CREATED_PAUSED' && (
        <p className="proposal-note">
          Creada en pausa{p.fin ? `; si se activa, corre hasta el ${new Date(p.fin).toLocaleDateString('es-DO')}` : ''}.{' '}
          {p.adsManager && (
            <a href={p.adsManager} target="_blank" rel="noreferrer">
              Abrir en Ads Manager para activarla
            </a>
          )}
        </p>
      )}
      {p.status === 'EXPIRED' && <p className="proposal-note proposal-note-warning">La tarjeta venció: pedile a Kaizen una nueva con datos actuales.</p>}
      {p.error && <p className="proposal-note proposal-note-warning">{p.error}</p>}

      {pendiente &&
        (puedeDecidir ? (
          <div className="proposal-actions">
            <button type="button" disabled={ocupada} onClick={() => onReject(p.id)}>
              Rechazar
            </button>
            <button type="button" className="primary" disabled={ocupada} onClick={() => onConfirm(p.id)}>
              Confirmar y crear en pausa
            </button>
          </div>
        ) : (
          <p className="proposal-note">Este anuncio necesita que un CEO / CTO lo confirme.</p>
        ))}
    </div>
  );
}
