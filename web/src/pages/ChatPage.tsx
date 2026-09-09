import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAgentStream } from '../hooks/useAgentStream';
import { useTheme } from '../hooks/useTheme';
import { ConversationList } from '../components/ConversationList';
import { ChatView } from '../components/ChatView';
import { Composer } from '../components/Composer';
import { AgentStatusBar } from '../components/AgentStatusBar';
import { MenuIcon } from '../components/Icons';
import { AuditPage } from './AuditPage';
import { MarketingPage } from './MarketingPage';
import { MetasPage } from './MetasPage';
import { UsuariosPage } from './UsuariosPage';
import type { ConversationSummary, Goal, Partner, Permiso, Proposal, StoredMessage } from '../types';

interface Props {
  partner: Partner;
  onLoggedOut: () => void;
}

// Calca server/prisma/schema.prisma → Conversation.title @default(...).
const DEFAULT_CONVERSATION_TITLE = 'Nueva conversación';

type Vista = 'chat' | 'metas' | 'audit' | 'marketing' | 'usuarios';

// Qué permiso hace falta para cada pestaña. Esconder una pestaña es cortesía:
// el servidor niega igual con 403 si alguien llama la API a mano (ver
// server/src/auth/permisos.ts). Acá solo se evita ofrecer puertas cerradas.
const PESTANAS: Array<{ vista: Vista; label: string; permiso: Permiso }> = [
  { vista: 'chat', label: 'Chat', permiso: 'chat' },
  { vista: 'metas', label: 'Metas', permiso: 'metas:ver' },
  { vista: 'audit', label: 'Auditoría', permiso: 'auditoria:ver' },
  { vista: 'marketing', label: 'Marketing', permiso: 'marketing:ver' },
  { vista: 'usuarios', label: 'Usuarios', permiso: 'usuarios:gestionar' },
];

/** Barra de error descartable. Antes no había forma de cerrarla: se quedaba
 *  hasta recargar la página, tapando el chat por un fallo ya superado. */
function BannerError({ mensaje, onClose }: { mensaje: string; onClose: () => void }) {
  return (
    <div className="banner-error" role="alert">
      <span className="banner-error-text">{mensaje}</span>
      <button type="button" className="banner-error-close" onClick={onClose} title="Cerrar" aria-label="Cerrar aviso">
        ✕
      </button>
    </div>
  );
}

export function ChatPage({ partner, onLoggedOut }: Props) {
  const { theme, toggleTheme } = useTheme();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [replacedGoals, setReplacedGoals] = useState<Goal[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Cajón de conversaciones en móvil. En escritorio el sidebar es una columna
  // fija y este estado no afecta nada.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Sección activa. Sin router (DISENO §10): son dos vistas dentro del mismo
  // layout, no dos rutas — el sidebar se queda donde está en ambas.
  const [view, setView] = useState<Vista>('chat');
  // Mensaje que se está editando. Vive acá y no en ChatView porque el cuadro
  // donde se corrige es el compositor, que es hermano de ChatView.
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);

  // Las pestañas que este socio puede ver, según su rol.
  const pestanas = PESTANAS.filter((p) => partner.permisos.includes(p.permiso));
  // Si la vista activa deja de estar permitida —por ejemplo porque un CEO/CTO
  // le bajó el rol mientras tenía Auditoría abierta— se cae a la primera
  // pestaña disponible en vez de quedarse en una pantalla que solo puede
  // mostrar 403s.
  const vistaValida = pestanas.some((p) => p.vista === view) ? view : (pestanas[0]?.vista ?? 'chat');
  if (vistaValida !== view) setView(vistaValida);

  const refreshConversations = useCallback(async () => {
    const { conversations: list } = await api.listConversations();
    setConversations(list);
    return list;
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const { messages: msgs, proposals: props, goals: gs, replacedGoals: rgs } = await api.getMessages(id);
    setMessages(msgs);
    setProposals(props);
    setGoals(gs);
    setReplacedGoals(rgs);
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
    setGoals([]);
    setReplacedGoals([]);
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
      // Si veníamos editando, esto NO es un mensaje nuevo: handleEditMessage
      // trunca el historial y pone su propio mensaje optimista, así que el de
      // abajo duplicaría.
      if (editando) {
        handleEditMessage(editando.id, text);
        return;
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.sendMessage, editando],
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
          setGoals([]);
          setReplacedGoals([]);
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

  // Confirmar una meta es un POST simple (no dispara turno del agente): el
  // evento sintético que deja routes/goals.ts alcanza para que el próximo
  // mensaje ya llegue con el contexto correcto.
  const handleConfirmGoal = async (goalId: string) => {
    try {
      await api.confirmGoal(goalId);
      if (activeId) await loadConversation(activeId);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'No se pudo confirmar la meta.');
    }
  };

  const handleRejectGoal = async (goalId: string) => {
    try {
      await api.rejectGoal(goalId);
      if (activeId) await loadConversation(activeId);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'No se pudo rechazar la meta.');
    }
  };

  const handleRejectProposal = async (proposalId: string) => {
    try {
      await fetch(`/api/proposals/${proposalId}/reject`, { method: 'POST', credentials: 'include' });
      if (activeId) await loadConversation(activeId);
    } catch {
      setLoadError('No se pudo rechazar la propuesta.');
    }
  };

  // "Editar" ya no manda nada: baja el texto al compositor para que el socio lo
  // corrija donde lo escribió. El envío real ocurre en handleSend.
  const empezarEdicion = (messageId: string, texto: string) => setEditando({ id: messageId, texto });

  // Editar/reintentar truncan localmente al instante (mismo espíritu que el
  // mensaje optimista de handleSend) — el turno real llega por SSE y
  // handleDone() recarga la versión real de la BD cuando termina.
  const handleEditMessage = (messageId: string, text: string) => {
    setEditando(null);
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

  /** Detener: se lo pide al server. El stream sigue abierto hasta que él cierre. */
  const detener = () => {
    if (activeId) api.stopRun(activeId).catch(() => setLoadError('No se pudo detener la respuesta.'));
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
        {/* Barra superior de la app. El botón de hamburguesa solo se ve en móvil
            (CSS), donde el chat ocupa la pantalla entera y es el único acceso a
            las conversaciones; las pestañas están siempre. */}
        <header className="chat-topbar">
          <button
            type="button"
            className="icon-button chat-topbar-menu"
            onClick={() => setSidebarOpen(true)}
            title="Mostrar conversaciones"
            aria-label="Mostrar conversaciones"
            aria-expanded={sidebarOpen}
          >
            <MenuIcon />
          </button>
          <nav className="app-tabs" aria-label="Secciones">
            {pestanas.map((p) => (
              <button
                key={p.vista}
                type="button"
                className={view === p.vista ? 'app-tab is-active' : 'app-tab'}
                onClick={() => setView(p.vista)}
                aria-current={view === p.vista ? 'page' : undefined}
              >
                {p.label}
              </button>
            ))}
          </nav>
          {view === 'chat' && <span className="chat-topbar-title">{activeTitle}</span>}
        </header>

        {view === 'metas' && <MetasPage />}
        {view === 'audit' && <AuditPage />}
        {view === 'marketing' && <MarketingPage />}
        {view === 'usuarios' && <UsuariosPage yo={partner} />}

        {view === 'chat' && loadError && (
          <BannerError mensaje={loadError} onClose={() => setLoadError(null)} />
        )}
        {view === 'chat' && stream.error && (
          <BannerError mensaje={stream.error} onClose={stream.clearError} />
        )}

        {view === 'chat' && (activeId ? (
          <>
            <ChatView
              messages={messages}
              proposals={proposals}
              goals={goals}
              replacedGoals={replacedGoals}
              liveText={stream.liveText}
              isStreaming={stream.isStreaming}
              onConfirmProposal={handleConfirmProposal}
              onRejectProposal={handleRejectProposal}
              onEditMessage={empezarEdicion}
              onRetryMessage={handleRetryMessage}
              onRewindMessage={handleRewindMessage}
              onConfirmGoal={handleConfirmGoal}
              onRejectGoal={handleRejectGoal}
              puedeConfirmarCampanas={partner.permisos.includes('campanas:confirmar')}
              puedeConfirmarMetas={partner.permisos.includes('metas:confirmar')}
            />
            <AgentStatusBar toolLabel={stream.toolStatus?.label ?? null} isStreaming={stream.isStreaming} />
            <Composer
              isStreaming={stream.isStreaming}
              onSend={handleSend}
              onStop={detener}
              editando={editando}
              onCancelarEdicion={() => setEditando(null)}
            />
          </>
        ) : (
          <div className="chat-empty">
            <p>Crea una conversación para empezar.</p>
          </div>
        ))}
      </main>
    </div>
  );
}
