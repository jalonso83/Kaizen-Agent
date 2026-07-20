import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ConversationSummary, Partner } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  partner: Partner;
  onLogout: () => void;
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  partner,
  onLogout,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deletingConversation, setDeletingConversation] = useState<ConversationSummary | null>(null);

  const startRename = (c: ConversationSummary) => {
    setEditingId(c.id);
    setEditValue(c.title);
  };

  const commitRename = () => {
    const title = editValue.trim();
    if (editingId && title) onRename(editingId, title);
    setEditingId(null);
  };

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setEditingId(null);
  };

  const confirmDelete = () => {
    if (deletingConversation) onDelete(deletingConversation.id);
    setDeletingConversation(null);
  };

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
          <div key={c.id} className={`conversation-row ${c.id === activeId ? 'active' : ''}`}>
            {editingId === c.id ? (
              <input
                className="conversation-rename-input"
                value={editValue}
                autoFocus
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleRenameKeyDown}
                maxLength={200}
              />
            ) : (
              <>
                <button type="button" className="conversation-item" onClick={() => onSelect(c.id)}>
                  {c.title}
                </button>
                <span className="conversation-actions">
                  <button
                    type="button"
                    className="conversation-action"
                    title="Renombrar conversación"
                    aria-label="Renombrar conversación"
                    onClick={() => startRename(c)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="conversation-action"
                    title="Eliminar conversación"
                    aria-label="Eliminar conversación"
                    onClick={() => setDeletingConversation(c)}
                  >
                    ✕
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="partner-name">{partner.name}</span>
        <button type="button" className="logout" onClick={onLogout}>
          Salir
        </button>
      </div>

      {deletingConversation && (
        <ConfirmDialog
          title="Eliminar conversación"
          message={`¿Eliminar "${deletingConversation.title}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeletingConversation(null)}
        />
      )}
    </aside>
  );
}
