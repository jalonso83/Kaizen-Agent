import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
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

  // Mensajes y propuestas se intercalan por createdAt en una sola línea de
  // tiempo — antes se pintaban en dos bloques separados (todos los mensajes,
  // luego todas las propuestas), así que una propuesta rechazada quedaba
  // "atrapada" debajo de mensajes posteriores de otro tema en vez de aparecer
  // en su lugar cronológico (bug real, 2026-07-26).
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
  const merged: Array<{ key: string; role?: StoredMessage['role']; blocks?: ReactNode[]; node?: ReactNode }> = [];
  for (const entry of sorted) {
    if (entry.kind === 'proposal') {
      merged.push({ key: `proposal-${entry.id}`, node: entry.node });
      continue;
    }
    const prev = merged[merged.length - 1];
    if (prev?.blocks && prev.role === 'assistant' && entry.role === 'assistant') {
      prev.blocks.push(...entry.blocks);
    } else {
      merged.push({ key: `message-${entry.id}`, role: entry.role, blocks: [...entry.blocks] });
    }
  }

  return (
    <div className="chat-view">
      {merged.map((item) =>
        item.blocks ? (
          <div key={item.key} className={`bubble bubble-${item.role}`}>
            {item.role === 'assistant' && <span className="bubble-who">Kaizen</span>}
            {item.blocks}
          </div>
        ) : (
          item.node
        ),
      )}

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
