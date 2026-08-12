import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAgentStream } from '../hooks/useAgentStream';
import { useTheme } from '../hooks/useTheme';
import { ConversationList } from '../components/ConversationList';
import { ChatView } from '../components/ChatView';
import { Composer } from '../components/Composer';
import { AgentStatusBar } from '../components/AgentStatusBar';
import { MenuIcon } from '../components/Icons';
import type { ConversationSummary, Partner, Proposal, StoredMessage } from '../types';

interface Props {
  partner: Partner;
  onLoggedOut: () => void;
}

// Calca server/prisma/schema.prisma → Conversation.title @default(...).
const DEFAULT_CONVERSATION_TITLE = 'Nueva conversación';

export function ChatPage({ partner, onLoggedOut }: Props) {
  const { theme, toggleTheme } = useTheme();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Cajón de conversaciones en móvil. En escritorio el sidebar es una columna
  // fija y este estado no afecta nada.
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  // Escape cierra el cajón, como cualquier panel superpuesto.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

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

    // Título automático tras el primer intercambio (mismo patrón que
    // Claude.ai): si ANTES de este turno la conversación seguía con el título
    // por defecto, generamos uno corto ahora que ya hay al menos un mensaje
    // del socio guardado. El endpoint es idempotente (solo pisa el default),
    // así que no hace falta trackear "primer mensaje" con más precisión acá.
    const wasDefaultTitle = conversations.find((c) => c.id === activeId)?.title === DEFAULT_CONVERSATION_TITLE;
    refreshConversations()
      .then(() => {
        if (!wasDefaultTitle) return;
        return api
          .autoTitleConversation(activeId)
          .then(() => refreshConversations())
          .catch(() => undefined); // best-effort — el título por defecto es un fallback aceptable
      })
      .catch(() => undefined);
  }, [activeId, loadConversation, refreshConversations, conversations]);

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

  const handleRename = async (id: string, title: string) => {
    try {
      await api.renameConversation(id, title);
      await refreshConversations();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'No se pudo renombrar la conversación.');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteConversation(id);
      const list = await refreshConversations();
      if (id === activeId) {
        if (list.length > 0) {
          await loadConversation(list[0].id);
        } else {
          setActiveId(null);
          setMessages([]);
          setProposals([]);
        }
      }
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'No se pudo eliminar la conversación.');
    }
  };

  // Confirmar dispara una corrida real del agente (create_campaign_draft) —
  // reusa el mismo mecanismo de streaming que un mensaje normal (barra de
  // estado, texto en vivo) en vez de un fetch mudo. La tarjeta se actualiza
  // sola al recargar el historial cuando el turno termina (stream.confirmProposal
  // ya llama a onDone internamente vía runStream).
  const handleConfirmProposal = (proposalId: string) => {
    stream.confirmProposal(proposalId).catch(() => setLoadError('No se pudo confirmar la propuesta.'));
  };

  const handleRejectProposal = async (proposalId: string) => {
    try {
      await fetch(`/api/proposals/${proposalId}/reject`, { method: 'POST', credentials: 'include' });
      if (activeId) await loadConversation(activeId);
    } catch {
      setLoadError('No se pudo rechazar la propuesta.');
    }
  };

  // Editar/reintentar truncan localmente al instante (mismo espíritu que el
  // mensaje optimista de handleSend) — el turno real llega por SSE y
  // handleDone() recarga la versión real de la BD cuando termina.
  const handleEditMessage = (messageId: string, text: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      const kept = idx === -1 ? prev : prev.slice(0, idx);
      return [
        ...kept,
        { id: `optimistic-${Date.now()}`, role: 'user', content: [{ type: 'text', text }], createdAt: new Date().toISOString() },
      ];
    });
    setProposals((prev) => prev.filter((p) => p.status !== 'PROPOSED'));
    stream.editMessage(messageId, text);
  };

  const handleRetryMessage = (messageId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      return idx === -1 ? prev : prev.slice(0, idx);
    });
    setProposals((prev) => prev.filter((p) => p.status !== 'PROPOSED'));
    stream.retryMessage(messageId);
  };

  const handleRewindMessage = async (messageId: string) => {
    if (!activeId) return;
    try {
      await api.rewindMessage(activeId, messageId);
      await loadConversation(activeId);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'No se pudo volver a ese mensaje.');
    }
  };

  const activeTitle = conversations.find((c) => c.id === activeId)?.title ?? 'Kaizen';

  return (
    <div className="chat-page">
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        // Abrir una conversación o crear una nueva cierra el cajón: en móvil
        // tapa el chat entero, así que dejarlo abierto esconde justo lo que el
        // socio acaba de pedir ver. En escritorio la clase no hace nada.
        onSelect={(id) => {
          setSidebarOpen(false);
          loadConversation(id).catch(() => setLoadError('No se pudo abrir esa conversación.'));
        }}
        onNew={() => {
          setSidebarOpen(false);
          handleNew().catch(() => setLoadError('No se pudo crear la conversación.'));
        }}
        onRename={handleRename}
        onDelete={handleDelete}
        partner={partner}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={toggleTheme}
        isOpen={sidebarOpen}
      />

      {/* Siempre montado, con la clase controlando la opacidad: si se montara
          solo al abrir, al cerrar desaparecería de golpe sin desvanecerse. */}
      <div
        className={`sidebar-backdrop${sidebarOpen ? ' is-open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <main className="chat-main">
        {/* Solo visible en móvil (CSS): ahí el chat ocupa la pantalla entera y
            este es el único acceso a las conversaciones. */}
        <header className="chat-topbar">
          <button
            type="button"
            className="icon-button"
            onClick={() => setSidebarOpen(true)}
            title="Mostrar conversaciones"
            aria-label="Mostrar conversaciones"
            aria-expanded={sidebarOpen}
          >
            <MenuIcon />
          </button>
          <span className="chat-topbar-title">{activeTitle}</span>
        </header>

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
              onEditMessage={handleEditMessage}
              onRetryMessage={handleRetryMessage}
              onRewindMessage={handleRewindMessage}
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
