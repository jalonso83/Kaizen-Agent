import type { ConversationSummary, Partner, Proposal, StoredMessage } from './types';

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

  deleteConversation: (conversationId: string) =>
    request<void>(`/api/conversations/${conversationId}`, { method: 'DELETE' }),
};
