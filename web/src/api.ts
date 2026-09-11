import type {
  AuditEvent,
  AnalisisInstagram,
  AuditOverview,
  CuentaMarketing,
  GoalHistory,
  ConversationSummary,
  Goal,
  Partner,
  Proposal,
  RolInfo,
  Rol,
  StoredMessage,
  Usuario,
  WeeklySummaryConfig,
} from './types';

// ─────────────────────────────────────────────────────────────────────────
// Cliente HTTP de la API de Kaizen. Rutas relativas ("/api/...") — same-origin
// gracias al proxy de Vite en dev y al static-serve de Express en producción
// (DISENO_FASE1.md §0.5), así nunca hace falta CORS ni manejar cookies a mano.
// ─────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new ApiError(res.status, body.message ?? `Error ${res.status}`);
  }

  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    request<Partner>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<Partner>('/api/auth/me'),

  cambiarMiPassword: (actual: string, nueva: string) =>
    request<{ ok: true }>('/api/auth/password', { method: 'POST', body: JSON.stringify({ actual, nueva }) }),

  // ── Gestión de usuarios (solo rol ADMIN; el servidor lo verifica) ──
  listarUsuarios: () => request<{ usuarios: Usuario[] }>('/api/users'),

  listarRoles: () => request<{ roles: RolInfo[] }>('/api/users/roles'),

  crearUsuario: (datos: { email: string; name: string; role: Rol; password: string }) =>
    request<Usuario>('/api/users', { method: 'POST', body: JSON.stringify(datos) }),

  actualizarUsuario: (id: string, cambios: { name?: string; role?: Rol }) =>
    request<Usuario>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(cambios) }),

  cambiarHabilitado: (id: string, disabled: boolean) =>
    request<Usuario>(`/api/users/${id}/disabled`, { method: 'POST', body: JSON.stringify({ disabled }) }),

  restablecerPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/api/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) }),

  // ── Marketing: los perfiles que Kaizen puede leer ───────────────────────
  // Se manda la URL tal cual la escribió la persona. El servidor deriva el
  // usuario y la URL canónica — no se hace acá a propósito: es la única capa
  // que la BD no puede saltarse, y tener el parseo en los dos lados garantiza
  // que un día se separen.
  listarCuentasMarketing: () => request<{ cuentas: CuentaMarketing[] }>('/api/marketing/accounts'),

  agregarCuentaMarketing: (datos: { url: string; red?: string; etiqueta?: string; esPropia?: boolean }) =>
    request<CuentaMarketing>('/api/marketing/accounts', { method: 'POST', body: JSON.stringify(datos) }),

  editarCuentaMarketing: (id: string, cambios: { etiqueta?: string; esPropia?: boolean }) =>
    request<CuentaMarketing>(`/api/marketing/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(cambios) }),

  borrarCuentaMarketing: (id: string) =>
    request<void>(`/api/marketing/accounts/${id}`, { method: 'DELETE' }),

  /** El análisis de un perfil guardado — el mismo que lee Kaizen. `refresh` salta la caché de 10 min del servidor. */
  leerInstagram: (usuario: string, refresh = false) =>
    request<AnalisisInstagram>(`/api/marketing/instagram/${encodeURIComponent(usuario)}${refresh ? '?refresh=1' : ''}`),

  listConversations: () => request<{ conversations: ConversationSummary[] }>('/api/conversations'),

  createConversation: () => request<ConversationSummary>('/api/conversations', { method: 'POST' }),

  getMessages: (conversationId: string) =>
    request<{ messages: StoredMessage[]; proposals: Proposal[]; goals: Goal[]; replacedGoals: Goal[] }>(
      `/api/conversations/${conversationId}/messages`,
    ),

  getGoalHistory: () => request<GoalHistory>('/api/goals/history'),

  confirmGoal: (goalId: string) => request<Goal>(`/api/goals/${goalId}/confirm`, { method: 'POST' }),
  rejectGoal: (goalId: string) => request<Goal>(`/api/goals/${goalId}/reject`, { method: 'POST' }),

  renameConversation: (conversationId: string, title: string) =>
    request<ConversationSummary>(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  autoTitleConversation: (conversationId: string) =>
    request<ConversationSummary>(`/api/conversations/${conversationId}/auto-title`, { method: 'POST' }),

  deleteConversation: (conversationId: string) =>
    request<void>(`/api/conversations/${conversationId}`, { method: 'DELETE' }),

  /**
   * Detener la respuesta en curso. NO aborta el fetch del stream a propósito:
   * el server necesita seguir con la conexión abierta para guardar lo que
   * Kaizen alcanzó a escribir, mandar `done` y recién ahí cerrar. Si el cliente
   * colgaba, recargaba el historial antes de que el fragmento estuviera guardado
   * y el texto a medias desaparecía (bug real, 2026-08-26).
   */
  stopRun: (conversationId: string) =>
    request<{ stopped: boolean }>(`/api/conversations/${conversationId}/stop`, { method: 'POST' }),

  getWeeklySummaryConfig: () => request<WeeklySummaryConfig>('/api/config/weekly-summary'),

  // Objeto y no 4 argumentos posicionales: son dos pares (qué semana / cuándo
  // corre) fáciles de confundir entre sí si van sueltos.
  updateWeeklySummaryConfig: (cfg: Pick<WeeklySummaryConfig, 'weekMode' | 'weekStartDay' | 'cronDay' | 'cronHour'>) =>
    request<WeeklySummaryConfig>('/api/config/weekly-summary', {
      method: 'PUT',
      body: JSON.stringify(cfg),
    }),

  runWeeklySummaryNow: () =>
    request<{ ok: true; from: string; to: string }>('/api/config/weekly-summary/run-now', { method: 'POST' }),

  reindexCerebro: () =>
    request<{ ok: true; updated: number; unchanged: number; omitted: number; deleted: number; failed: string[] }>(
      '/api/config/cerebro/reindex',
      { method: 'POST' },
    ),

  getAuditOverview: () => request<AuditOverview>('/api/audit/overview'),

  getAuditEvents: (opts: { level: 'important' | 'all'; onlyErrors: boolean; from?: string; cursor?: string }) => {
    const qs = new URLSearchParams({ level: opts.level, onlyErrors: String(opts.onlyErrors) });
    if (opts.from) qs.set('from', opts.from);
    if (opts.cursor) qs.set('cursor', opts.cursor);
    return request<{ events: AuditEvent[]; nextCursor: string | null }>(`/api/audit/events?${qs}`);
  },

  // Edit/retry SÍ disparan un turno del agente (SSE) — los maneja useAgentStream,
  // no request(). Este solo "vuelve" a un punto anterior sin resend, sin stream.
  rewindMessage: (conversationId: string, messageId: string) =>
    request<void>(`/api/conversations/${conversationId}/messages/${messageId}/rewind`, { method: 'POST' }),
};
