// ─────────────────────────────────────────────────────────────────────────
// Tipos compartidos del frontend. Los content blocks calcan los de la API de
// Anthropic (así se guardan crudos en Message.content — ver server §2.2/2.4).
// ─────────────────────────────────────────────────────────────────────────

export interface Partner {
  id: string;
  name: string;
  email: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [key: string]: unknown };

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  createdAt: string;
}

export type ProposalStatus =
  | 'PROPOSED'
  | 'CONFIRMED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'UNKNOWN_OUTCOME';

export interface CampaignPayload {
  title: string;
  message: string;
  segment_slug: string;
  segment_params?: Record<string, string | number>;
  rationale: string;
  surface?: 'push' | 'slot' | 'both';
  holdout_pct?: number;
}

// Calca server/prisma/schema.prisma → model Proposal (lo que devuelve
// GET /api/conversations/:id/messages tal cual, sin transformar).
export interface Proposal {
  id: string;
  conversationId: string;
  status: ProposalStatus;
  payload: CampaignPayload;
  segmentCount: number | null;
  finzenCampaignId: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  executedAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
