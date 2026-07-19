import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAgentStream } from '../hooks/useAgentStream';
import { ConversationList } from '../components/ConversationList';
import { ChatView } from '../components/ChatView';
import { Composer } from '../components/Composer';
import { AgentStatusBar } from '../components/AgentStatusBar';
import type { ConversationSummary, Partner, Proposal, StoredMessage } from '../types';

interface Props {
  partner: Partner;
  onLoggedOut: () => void;
}

export function ChatPage({ partner, onLoggedOut }: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshConversations = useCallback(async () => {
    const { conversations: list } = await api.listConversations();
    setConversations(list);
    return list;
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const { messages: msgs, proposals: props } = await api.getMessages(id);
    setMessages(msgs);
    setProposals(props);
    setActiveId(id);
  }, []);

  // Al montar: cargar la lista, y abrir la más reciente si existe.
  useEffect(() => {
    refreshConversations()
      .then((list) => {
        if (list.length > 0) return loadConversation(list[0].id);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'No se pudieron cargar las conversaciones.'));
  }, [refreshConversations, loadConversation]);

  const handleNew = useCallback(async () => {
    const conversation = await api.createConversation();
    await refreshConversations();
    setMessages([]);
    setProposals([]);
    setActiveId(conversation.id);
  }, [refreshConversations]);

  const handleDone = useCallback(() => {
    if (!activeId) return;
    // La fuente de verdad es el server: al terminar un turno, recargamos.
    loadConversation(activeId).catch(() => undefined);
    refreshConversations().catch(() => undefined);
  }, [activeId, loadConversation, refreshConversations]);

  const stream = useAgentStream(activeId, handleDone);

  // Muestra el mensaje del socio AL INSTANTE, sin esperar el turno completo
  // (antes: nada se pintaba hasta el próximo loadConversation() en onDone,
  // así que si Kaizen no podía responder — o solo mientras pensaba — el
  // mensaje recién escrito no aparecía en ningún lado; bug real, 2026-07-19).
  // Es un id temporal — cuando termine el turno, loadConversation() trae la
  // fila real de la BD y reemplaza esta lista entera, optimista incluido.
  const handleSend = useCallback(
    (text: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `optimistic-${Date.now()}`,
          role: 'user',
          content: [{ type: 'text', text }],
          createdAt: new Date().toISOString(),
        },
      ]);
      stream.sendMessage(text);
    },
    [stream.sendMessage],
  );

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    onLoggedOut();
  };

  // El gate (propose_campaign/create_campaign_draft) todavía no existe en el
  // server — ver server/README.md §10. Estas dos rutas 404 hasta esa slice.
  const handleConfirmProposal = async (proposalId: string) => {
    try {
      await fetch(`/api/proposals/${proposalId}/confirm`, { method: 'POST', credentials: 'include' });
      if (activeId) await loadConversation(activeId);
    } catch {
      setLoadError('Confirmar propuestas todavía no está disponible en el server.');
    }
  };

  const handleRejectProposal = async (proposalId: string) => {
    try {
      await fetch(`/api/proposals/${proposalId}/reject`, { method: 'POST', credentials: 'include' });
      if (activeId) await loadConversation(activeId);
    } catch {
      setLoadError('Rechazar propuestas todavía no está disponible en el server.');
    }
  };

  return (
    <div className="chat-page">
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => loadConversation(id).catch(() => setLoadError('No se pudo abrir esa conversación.'))}
        onNew={() => handleNew().catch(() => setLoadError('No se pudo crear la conversación.'))}
        partner={partner}
        onLogout={handleLogout}
      />

      <main className="chat-main">
        {loadError && <div className="banner-error">{loadError}</div>}
        {stream.error && <div className="banner-error">{stream.error}</div>}

        {activeId ? (
          <>
            <ChatView
              messages={messages}
              proposals={proposals}
              liveText={stream.liveText}
              isStreaming={stream.isStreaming}
              onConfirmProposal={handleConfirmProposal}
              onRejectProposal={handleRejectProposal}
            />
            <AgentStatusBar toolLabel={stream.toolStatus?.label ?? null} isStreaming={stream.isStreaming} />
            <Composer disabled={stream.isStreaming} onSend={handleSend} />
          </>
        ) : (
          <div className="chat-empty">
            <p>Creá una conversación para empezar.</p>
          </div>
        )}
      </main>
    </div>
  );
}
