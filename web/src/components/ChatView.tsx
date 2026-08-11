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
  type SortedEntry = MessageEntry | ProposalEntry;

  const messageEntries: (MessageEntry | null)[] = messages.map((message) => {
    const blocks = message.content
      .map((block, i) => renderBlock(block, `${message.id}-${i}`))
      .filter((b) => b !== null);

    if (blocks.length === 0) return null; // burbuja sin nada que mostrar (p.ej. tool_result)

    return { kind: 'message', role: message.role, id: message.id, createdAt: message.createdAt, blocks };
  });

  const proposalEntries: ProposalEntry[] = proposals.map((proposal) => ({
    kind: 'proposal',
    id: proposal.id,
    createdAt: proposal.createdAt,
    node: <ProposalCard key={proposal.id} proposal={proposal} onConfirm={onConfirmProposal} onReject={onRejectProposal} />,
  }));

  const sorted: SortedEntry[] = [...messageEntries, ...proposalEntries]
    .filter((item): item is SortedEntry => item !== null)
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
  const merged: Array<{ key: string; role?: StoredMessage['role']; blocks?: ReactNode[]; firstId?: string; lastId?: string; node?: ReactNode }> = [];
  for (const entry of sorted) {
    if (entry.kind === 'proposal') {
      merged.push({ key: `proposal-${entry.id}`, node: entry.node });
      continue;
    }
    const prev = merged[merged.length - 1];
    if (prev?.blocks && prev.role === 'assistant' && entry.role === 'assistant') {
      prev.blocks.push(...entry.blocks);
      prev.lastId = entry.id;
    } else {
      merged.push({ key: `message-${entry.id}`, role: entry.role, blocks: [...entry.blocks], firstId: entry.id, lastId: entry.id });
    }
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
