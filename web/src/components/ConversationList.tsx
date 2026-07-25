import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ConversationSummary, Partner } from '../types';
import type { Theme } from '../hooks/useTheme';
import { ConfirmDialog } from './ConfirmDialog';
import { ConfigDialog } from './ConfigDialog';

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  partner: Partner;
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
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
  theme,
  onToggleTheme,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deletingConversation, setDeletingConversation] = useState<ConversationSummary | null>(null);
  const [showConfig, setShowConfig] = useState(false);

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
        <span className="brand-group">
          {/* Isotipo real de FinZen (extraído de finzen-manual-de-marca.pdf) — a pedido del
              socio, "por ahora" como logo de Kaizen hasta que definan uno propio. */}
          <img src="/logo.png" alt="FinZen" className="brand-logo" />
          <span className="brand">Kaizen</span>
        </span>
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
        <span className="sidebar-footer-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setShowConfig(true)}
            title="Configuración"
            aria-label="Configuración"
          >
            ⚙
          </button>
          <button type="button" className="logout" onClick={onLogout}>
            Salir
          </button>
        </span>
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

      {showConfig && <ConfigDialog onClose={() => setShowConfig(false)} />}
    </aside>
  );
}
