import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ConversationSummary, Partner } from '../types';
import type { Theme } from '../hooks/useTheme';
import { ConfirmDialog } from './ConfirmDialog';
import { ConfigDialog } from './ConfigDialog';
import { CambiarPasswordDialog } from './CambiarPasswordDialog';
import { GearIcon, KeyIcon, MoonIcon, SunIcon } from './Icons';

/** Calca ETIQUETA_ROL de server/src/auth/permisos.ts. */
const ROL_LABEL: Record<string, string> = {
  ADMIN: 'CEO / CTO',
  ASSISTANT: 'Asistente',
  USER: 'Usuario',
};

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
  /** Solo aplica en móvil, donde el panel es un cajón deslizable sobre el chat. */
  isOpen: boolean;
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
  isOpen,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deletingConversation, setDeletingConversation] = useState<ConversationSummary | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
    <aside className={`sidebar${isOpen ? ' is-open' : ''}`}>
      <div className="sidebar-header">
        {/* El wordmark ya dice "KAIZEN", así que reemplaza al par isotipo+texto
            que había antes con el logo de FinZen. */}
        <span className="wordmark brand-wordmark" role="img" aria-label="Kaizen" />
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
        <span className="partner-identidad">
          <span className="partner-name">{partner.name}</span>
          {/* El rol se muestra siempre: saber con qué permisos estás entrando
              evita el "¿por qué no me aparece Auditoría?" sin respuesta. */}
          <span className="partner-rol">{ROL_LABEL[partner.role] ?? partner.role}</span>
        </span>
        <span className="sidebar-footer-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowPassword(true)}
            title="Cambiar mi contraseña"
            aria-label="Cambiar mi contraseña"
          >
            <KeyIcon />
          </button>
          {/* La configuración del resumen semanal y el reindexado son del
              CEO/CTO. El servidor los niega igual (permiso 'config:editar');
              esconder el botón solo evita ofrecer algo que va a fallar. */}
          {partner.permisos.includes('config:editar') && (
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowConfig(true)}
              title="Configuración"
              aria-label="Configuración"
            >
              <GearIcon />
            </button>
          )}
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
      {showPassword && <CambiarPasswordDialog onClose={() => setShowPassword(false)} />}
    </aside>
  );
}
