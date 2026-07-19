import type { ConversationSummary, Partner } from '../types';

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  partner: Partner;
  onLogout: () => void;
}

export function ConversationList({ conversations, activeId, onSelect, onNew, partner, onLogout }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="brand">Kaizen</span>
        <button type="button" className="new-conversation" onClick={onNew}>
          + Nueva
        </button>
      </div>

      <nav className="conversation-list" aria-label="Conversaciones">
        {conversations.length === 0 && <p className="conversation-empty">Todavía no hay conversaciones.</p>}
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`conversation-item ${c.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            {c.title}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="partner-name">{partner.name}</span>
        <button type="button" className="logout" onClick={onLogout}>
          Salir
        </button>
      </div>
    </aside>
  );
}
