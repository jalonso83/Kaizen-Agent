import type { ConversationSummary, Partner, Proposal, StoredMessage, WeeklySummaryConfig } from './types';

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

  listConversations: () => request<{ conversations: ConversationSummary[] }>('/api/conversations'),

  createConversation: () => request<ConversationSummary>('/api/conversations', { method: 'POST' }),

  getMessages: (conversationId: string) =>
    request<{ messages: StoredMessage[]; proposals: Proposal[] }>(`/api/conversations/${conversationId}/messages`),

  renameConversation: (conversationId: string, title: string) =>
    request<ConversationSummary>(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  autoTitleConversation: (conversationId: string) =>
    request<ConversationSummary>(`/api/conversations/${conversationId}/auto-title`, { method: 'POST' }),

  deleteConversation: (conversationId: string) =>
    request<void>(`/api/conversations/${conversationId}`, { method: 'DELETE' }),

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
    request<{ ok: true; updated: number; unchanged: number; omitted: number; deleted: number }>(
      '/api/config/cerebro/reindex',
      { method: 'POST' },
    ),

  // Edit/retry SÍ disparan un turno del agente (SSE) — los maneja useAgentStream,
  // no request(). Este solo "vuelve" a un punto anterior sin resend, sin stream.
  rewindMessage: (conversationId: string, messageId: string) =>
    request<void>(`/api/conversations/${conversationId}/messages/${messageId}/rewind`, { method: 'POST' }),
};
