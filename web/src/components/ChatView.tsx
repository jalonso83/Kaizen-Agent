import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ContentBlock, Proposal, StoredMessage } from '../types';
import { ProposalCard } from './ProposalCard';
import { ConfirmDialog } from './ConfirmDialog';

// ─────────────────────────────────────────────────────────────────────────
// Burbujas de chat. Los bloques `thinking` NUNCA se muestran (DISENO §10);
// tool_use y tool_result tampoco se pintan (a pedido del socio, 2026-07-20 —
// mostrar qué tool corrió era ruido, no información útil para el socio) — su
// contenido ya se refleja en la respuesta de texto. Por eso un mensaje que
// SOLO tiene tool_use/tool_result no tiene nada para pintar y su burbuja
// entera se omite (antes aparecía una burbuja "VOS" vacía — bug real,
// 2026-07-19).
//
// Sin etiqueta "VOS": en un chat de IA es obvio que el mensaje alineado a la
// derecha es tuyo (a pedido explícito, matching la convención de chats de IA
// reales). "Kaizen" sí se mantiene del otro lado.
//
// Los mensajes sintéticos <evento_sistema> (routes/proposals.ts, al confirmar
// una tarjeta) tampoco se muestran — son instrucciones internas para el
// modelo, no algo que el socio escribió; sin este filtro aparecían como una
// burbuja con el XML crudo apenas pulsabas "Confirmar" (bug real, 2026-07-24).
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_EVENT_RE = /^<evento_sistema>[\s\S]*<\/evento_sistema>$/;

function renderBlock(block: ContentBlock, key: string) {
  if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
    const trimmed = block.text.trim();
    if (SYSTEM_EVENT_RE.test(trimmed)) return null;
    return (
      <div key={key} className="bubble-text">
        <ReactMarkdown>{block.text}</ReactMarkdown>
      </div>
    );
  }

  // thinking, tool_use, tool_result y cualquier bloque futuro no reconocido:
  // no se muestran directamente.
  return null;
}

/** Texto plano de un mensaje (para precargar el textarea de "editar") — concatena
 * los bloques de texto visibles, mismo filtro de <evento_sistema> que renderBlock. */
function plainText(message: StoredMessage): string {
  return message.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b as { text: string }).text)
    .filter((t) => t.trim().length > 0 && !SYSTEM_EVENT_RE.test(t.trim()))
    .join('\n\n');
}

interface Props {
  messages: StoredMessage[];
  proposals: Proposal[];
  liveText: string;
  isStreaming: boolean;
  onConfirmProposal: (proposalId: string) => void;
  onRejectProposal: (proposalId: string) => void;
  onEditMessage: (messageId: string, text: string) => void;
  onRetryMessage: (messageId: string) => void;
  onRewindMessage: (messageId: string) => void;
}

export function ChatView({
  messages,
  proposals,
  liveText,
  isStreaming,
  onConfirmProposal,
  onRejectProposal,
  onEditMessage,
  onRetryMessage,
  onRewindMessage,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [rewindTarget, setRewindTarget] = useState<string | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, liveText]);

  const startEdit = (message: StoredMessage) => {
    setEditingId(message.id);
    setEditText(plainText(message));
  };
  const cancelEdit = () => setEditingId(null);
  const submitEdit = () => {
    const text = editText.trim();
    if (editingId && text) onEditMessage(editingId, text);
    setEditingId(null);
  };

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="chat-empty">
        <p>Empezá la conversación. Por ejemplo:</p>
        <p className="chat-empty-example">&ldquo;Buscame la gente que tiene su presupuesto pasado&rdquo;</p>
      </div>
    );
  }

  // Mensajes y propuestas se intercalan por createdAt en una sola línea de
  // tiempo — antes se pintaban en dos bloques separados (todos los mensajes,
  // luego todas las propuestas), así que una propuesta rechazada quedaba
  // "atrapada" debajo de mensajes posteriores de otro tema en vez de aparecer
  // en su lugar cronológico (bug real, 2026-07-26).
  const byId = new Map(messages.map((m) => [m.id, m]));

  type MessageEntry = { kind: 'message'; role: StoredMessage['role']; id: string; createdAt: string; blocks: ReactNode[] };
  type ProposalEntry = { kind: 'proposal'; id: string; createdAt: string; node: ReactNode };
  // Frontera invisible: un mensaje que no se pinta pero que SÍ separa turnos.
  type BoundaryEntry = { kind: 'boundary'; id: string; createdAt: string };

  /** ¿Es un <evento_sistema>? Son acciones REALES del socio (confirmar/rechazar
   *  una tarjeta) que no se muestran, a diferencia de un tool_result, que es
   *  continuación del mismo turno. */
  const esEventoSistema = (m: StoredMessage) =>
    m.role === 'user' &&
    m.content.some(
      (b) => b.type === 'text' && typeof b.text === 'string' && SYSTEM_EVENT_RE.test(b.text.trim()),
    );

  const messageEntries: (MessageEntry | BoundaryEntry | null)[] = messages.map((message) => {
    const blocks = message.content
      .map((block, i) => renderBlock(block, `${message.id}-${i}`))
      .filter((b) => b !== null);

    if (blocks.length === 0) {
      // Sin nada que pintar. Si además es un evento del sistema, se conserva
      // como frontera: el socio hizo algo (pulsó Confirmar) y lo que viene
      // después es otro turno, no la continuación del anterior.
      return esEventoSistema(message)
        ? { kind: 'boundary', id: message.id, createdAt: message.createdAt }
        : null;
    }

    return { kind: 'message', role: message.role, id: message.id, createdAt: message.createdAt, blocks };
  });

  const proposalEntries: ProposalEntry[] = proposals
    .map((proposal): ProposalEntry => ({
      kind: 'proposal',
      id: proposal.id,
      createdAt: proposal.createdAt,
      node: <ProposalCard key={proposal.id} proposal={proposal} onConfirm={onConfirmProposal} onReject={onRejectProposal} />,
    }))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Las propuestas NO entran en este orden: se insertan después, al cierre del
  // turno que las creó (ver más abajo).
  const sorted: Array<MessageEntry | BoundaryEntry> = messageEntries
    .filter((item): item is MessageEntry | BoundaryEntry => item !== null)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Kaizen puede escribir varias rondas cortas de texto entre tool-calls
  // dentro de un mismo turno; cada ronda queda en su propia fila de la BD
  // (runner.ts persiste un Message por ronda), pero visualmente es UNA sola
  // respuesta — igual a como ya se ve en vivo mientras streamea (liveText
  // crece continuo, sin cortes). Se fusionan burbujas de assistant
  // consecutivas (sin una propuesta ni un mensaje del socio entre medio) en
  // una sola burbuja, para que el historial recargado luzca igual que en vivo.
  // firstId/lastId: para reintentar (y editar, que nunca fusiona) el ancla es
  // el PRIMER mensaje real de la burbuja — ahí es donde arranca la respuesta
  // que se va a rehacer. Para "volver aquí" el ancla es el ÚLTIMO — si se
  // usara el primero, volver a una burbuja fusionada borraría sus propias
  // rondas siguientes junto con lo que viene después (bug que evitamos acá).
  type Grupo = {
    key: string;
    role?: StoredMessage['role'];
    blocks?: ReactNode[];
    firstId?: string;
    lastId?: string;
    node?: ReactNode;
    /** createdAt del primer mensaje del grupo — para ubicar las tarjetas. */
    desde?: string;
  };

  const merged: Grupo[] = [];
  // Una frontera no se pinta, pero corta la racha: sin esto, "la paso a
  // tarjeta", "confirmada, creo el borrador" y "borrador creado" —tres turnos
  // separados por el clic del socio en Confirmar— caían en una sola burbuja
  // (bug real, 2026-08-17).
  let cortar = false;
  for (const entry of sorted) {
    if (entry.kind === 'boundary') {
      cortar = true;
      continue;
    }
    const prev = merged[merged.length - 1];
    if (!cortar && prev?.blocks && prev.role === 'assistant' && entry.role === 'assistant') {
      prev.blocks.push(...entry.blocks);
      prev.lastId = entry.id;
    } else {
      merged.push({
        key: `message-${entry.id}`,
        role: entry.role,
        blocks: [...entry.blocks],
        firstId: entry.id,
        lastId: entry.id,
        desde: entry.createdAt,
      });
    }
    cortar = false;
  }

  // La tarjeta va al CIERRE del turno que la creó, no en el instante exacto en
  // que la tool la registró. Es el resultado del turno: ponerla en su timestamp
  // exacto la dejaba en medio de la respuesta, antes de la frase que la anuncia
  // ("listo, la tarjeta ya está en el chat"), que se lee al revés.
  // Cada propuesta se inserta después del último grupo que ya había empezado
  // cuando se creó.
  for (const p of proposalEntries) {
    const t = new Date(p.createdAt).getTime();
    let idx = -1;
    for (let i = 0; i < merged.length; i++) {
      const desde = merged[i].desde;
      if (desde && new Date(desde).getTime() <= t) idx = i;
    }
    merged.splice(idx + 1, 0, { key: `proposal-${p.id}`, node: p.node });
  }

  return (
    <div className="chat-view">
      {merged.map((item) => {
        if (!item.blocks) return item.node;

        const isEditing = editingId === item.firstId;
        return (
          // Los botones van FUERA de la burbuja (hermanos, no hijos) para que no
          // ensucien el globo de texto; el grupo es quien detecta el hover.
          <div key={item.key} className={`message-group message-group-${item.role}`}>
            <div className={`bubble bubble-${item.role}`}>
              {item.role === 'assistant' && <span className="bubble-who">Kaizen</span>}

              {isEditing ? (
                <div className="bubble-edit">
                  <textarea
                    className="bubble-edit-input"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    autoFocus
                    rows={Math.min(10, Math.max(2, editText.split('\n').length))}
                  />
                  <div className="bubble-edit-actions">
                    <button type="button" className="dialog-cancel" onClick={cancelEdit}>Cancelar</button>
                    <button type="button" className="dialog-confirm" onClick={submitEdit} disabled={!editText.trim()}>Enviar</button>
                  </div>
                </div>
              ) : (
                item.blocks
              )}
            </div>

            {!isStreaming && !isEditing && (
              <span className="bubble-actions">
                {item.role === 'user' && item.firstId && (
                  <button
                    type="button"
                    className="bubble-action"
                    title="Editar mensaje"
                    aria-label="Editar mensaje"
                    onClick={() => { const m = byId.get(item.firstId!); if (m) startEdit(m); }}
                  >
                    ✎
                  </button>
                )}
                {item.role === 'assistant' && item.firstId && (
                  <button
                    type="button"
                    className="bubble-action"
                    title="Reintentar respuesta"
                    aria-label="Reintentar respuesta"
                    onClick={() => onRetryMessage(item.firstId!)}
                  >
                    ↻
                  </button>
                )}
                {item.lastId && (
                  <button
                    type="button"
                    className="bubble-action"
                    title="Volver a este mensaje"
                    aria-label="Volver a este mensaje"
                    onClick={() => setRewindTarget(item.lastId!)}
                  >
                    ↺
                  </button>
                )}
              </span>
            )}
          </div>
        );
      })}

      {isStreaming && (
        <div className="bubble bubble-assistant bubble-live">
          <span className="bubble-who">Kaizen</span>
          <div className="bubble-text">
            <ReactMarkdown>{liveText}</ReactMarkdown>
            <span className="cursor" aria-hidden="true" />
          </div>
        </div>
      )}

      <div ref={endRef} />

      {rewindTarget && (
        <ConfirmDialog
          title="¿Volver a este mensaje?"
          message="Se borra todo lo que viene después, sin poder deshacerlo."
          confirmLabel="Volver aquí"
          onConfirm={() => { onRewindMessage(rewindTarget); setRewindTarget(null); }}
          onCancel={() => setRewindTarget(null)}
        />
      )}
    </div>
  );
}
