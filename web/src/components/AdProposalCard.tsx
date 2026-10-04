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

const RECOMENDACION_LABEL: Record<NonNullable<AdProposal['recomendacion']>, string> = {
  seguir: 'Seguir',
  pausar: 'Pausar',
  cambiar_post: 'Probar otro post',
};

const ESTADO_META: Record<string, string> = {
  ACTIVE: 'Activa en Meta',
  PAUSED: 'Pausada en Meta',
  CAMPAIGN_PAUSED: 'Pausada en Meta',
  ADSET_PAUSED: 'Pausada en Meta',
  DELETED: 'Borrada en Meta',
  ARCHIVED: 'Archivada en Meta',
};

const num = (n: number) => n.toLocaleString('es-DO');

/**
 * Lo que trajo el anuncio (2026-10-05). Todo viene calculado del servidor
 * (services/resultadosAnuncios.ts). "Clics a descargar" se llama así y no
 * "registros" a propósito: es lo que es (skill lectura-adquisicion-finzen §1).
 */
function Resultados({ p }: { p: AdProposal }) {
  const r = p.resultado!;
  const faltan = Math.max(0, 7 - r.diasConGasto);
  return (
    <div className="ad-resultados">
      <p className="ad-resultados-titulo">
        {ESTADO_META[r.estadoMeta] ?? r.estadoMeta} · {r.diasConGasto} {r.diasConGasto === 1 ? 'día' : 'días'} con gasto
        {p.resultadoEn && <span> · leído el {new Date(p.resultadoEn).toLocaleDateString('es-DO')}</span>}
      </p>
      <dl className="proposal-meta">
        <div>
          <dt>Gastado</dt>
          <dd>{dinero(r.gasto, p.moneda)}</dd>
        </div>
        <div>
          <dt>Impresiones</dt>
          <dd>{num(r.impresiones)}</dd>
        </div>
        <div>
          <dt>Clics al enlace</dt>
          <dd>
            {num(r.clicsEnlace)}
            {r.ctrPct != null ? ` · CTR ${r.ctrPct}%` : ''}
            {r.costoPorClic != null ? ` · ${dinero(r.costoPorClic, p.moneda)} c/u` : ''}
          </dd>
        </div>
        {r.finzen && (
          <div>
            <dt>En la landing</dt>
            <dd>
              {num(r.finzen.visitantes)} visitantes · {num(r.finzen.clicsDescarga)} clics a descargar
              {r.costoPorClicDescarga != null ? ` · ${dinero(r.costoPorClicDescarga, p.moneda)} c/u` : ''}
            </dd>
          </div>
        )}
      </dl>
      {r.avisos.map((a) => (
        <p key={a} className="proposal-note proposal-note-warning">{a}</p>
      ))}
      {p.recomendacion ? (
        <div className={`ad-recomendacion is-${p.recomendacion}`}>
          <span className="ad-recomendacion-pill">Kaizen recomienda: {RECOMENDACION_LABEL[p.recomendacion]}</span>
          {p.recomendacionRazon && <p>{p.recomendacionRazon}</p>}
          {p.recomendacion !== 'seguir' && p.adsManager && (
            <a href={p.adsManager} target="_blank" rel="noreferrer">Hacerlo en Ads Manager</a>
          )}
        </div>
      ) : (
        <p className="proposal-note">
          {faltan > 0
            ? `Kaizen lo evalúa con 7 días con gasto: faltan ${faltan}. Antes, Meta todavía está aprendiendo.`
            : 'Kaizen lo evalúa en la próxima lectura (todos los días a las 7am).'}
        </p>
      )}
    </div>
  );
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
        <span className="proposal-status-pill">
          {ocupada
            ? 'Creando en Meta…'
            : p.status === 'CREATED_PAUSED' && p.resultado?.primerDiaConGasto
              ? (ESTADO_META[p.resultado.estadoMeta] ?? p.resultado.estadoMeta)
              : STATUS_LABEL[p.status]}
        </span>
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
      {p.status === 'CREATED_PAUSED' && !p.resultado?.primerDiaConGasto && (
        <p className="proposal-note">
          Creada en pausa{p.fin ? `; si se activa, corre hasta el ${new Date(p.fin).toLocaleDateString('es-DO')}` : ''}.{' '}
          {p.adsManager && (
            <a href={p.adsManager} target="_blank" rel="noreferrer">
              Abrir en Ads Manager para activarla
            </a>
          )}
        </p>
      )}
      {p.status === 'CREATED_PAUSED' && p.resultado?.primerDiaConGasto && <Resultados p={p} />}
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
