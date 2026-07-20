import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ContentBlock, Proposal, StoredMessage } from '../types';
import { ProposalCard } from './ProposalCard';

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
// ─────────────────────────────────────────────────────────────────────────

function renderBlock(block: ContentBlock, key: string) {
  if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
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

interface Props {
  messages: StoredMessage[];
  proposals: Proposal[];
  liveText: string;
  isStreaming: boolean;
  onConfirmProposal: (proposalId: string) => void;
  onRejectProposal: (proposalId: string) => void;
}

export function ChatView({ messages, proposals, liveText, isStreaming, onConfirmProposal, onRejectProposal }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, liveText]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="chat-empty">
        <p>Empezá la conversación. Por ejemplo:</p>
        <p className="chat-empty-example">&ldquo;Buscame la gente que tiene su presupuesto pasado&rdquo;</p>
      </div>
    );
  }

  return (
    <div className="chat-view">
      {messages.map((message) => {
        const blocks = message.content
          .map((block, i) => renderBlock(block, `${message.id}-${i}`))
          .filter((b) => b !== null);

        if (blocks.length === 0) return null; // burbuja sin nada que mostrar (p.ej. tool_result)

        return (
          <div key={message.id} className={`bubble bubble-${message.role}`}>
            {message.role === 'assistant' && <span className="bubble-who">Kaizen</span>}
            {blocks}
          </div>
        );
      })}

      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} onConfirm={onConfirmProposal} onReject={onRejectProposal} />
      ))}

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
    </div>
  );
}
