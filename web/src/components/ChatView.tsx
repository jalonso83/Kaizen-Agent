import { useEffect, useRef } from 'react';
import type { ContentBlock, Proposal, StoredMessage } from '../types';
import { ProposalCard } from './ProposalCard';

// ─────────────────────────────────────────────────────────────────────────
// Burbujas de chat. Los bloques `thinking` NUNCA se muestran (DISENO §10);
// los tool_use del historial se pintan como chips discretos.
// ─────────────────────────────────────────────────────────────────────────

function renderBlock(block: ContentBlock, key: string) {
  if (block.type === 'thinking') return null;

  if (block.type === 'text' && typeof block.text === 'string') {
    return (
      <p key={key} className="bubble-text">
        {block.text}
      </p>
    );
  }

  if (block.type === 'tool_use' && typeof block.name === 'string') {
    return (
      <span key={key} className="tool-chip">
        tool: {block.name}
      </span>
    );
  }

  // tool_result y cualquier bloque futuro no reconocido: no se muestran
  // directamente (su contenido ya se reflejó en la respuesta de texto).
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
      {messages.map((message) => (
        <div key={message.id} className={`bubble bubble-${message.role}`}>
          <span className="bubble-who">{message.role === 'user' ? 'Vos' : 'Kaizen'}</span>
          {message.content.map((block, i) => renderBlock(block, `${message.id}-${i}`))}
        </div>
      ))}

      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} onConfirm={onConfirmProposal} onReject={onRejectProposal} />
      ))}

      {isStreaming && (
        <div className="bubble bubble-assistant bubble-live">
          <span className="bubble-who">Kaizen</span>
          <p className="bubble-text">
            {liveText}
            <span className="cursor" aria-hidden="true" />
          </p>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
