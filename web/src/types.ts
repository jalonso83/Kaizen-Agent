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
  | 'UNKNOWN_OUTCOME'
  | 'EXPIRED';

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
  expectedMeasurement: string | null;
  messageType: string | null;
  finzenCampaignId: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  executedAt: string | null;
  error: string | null;
  createdAt: string;
}

// Calca server/prisma/schema.prisma → model Goal.
export type GoalStatus = 'PROPOSED' | 'ACTIVE' | 'ACHIEVED' | 'REJECTED' | 'SUPERSEDED';

export interface Goal {
  id: string;
  conversationId: string | null;
  metric: string;
  metricLabel: string;
  target: number;
  unit: string;
  /** 'gte': se logra al alcanzar o superar. 'lte': al bajar de él (churn, CAC). */
  direction: 'gte' | 'lte';
  rationale: string;
  status: GoalStatus;
  confirmedAt: string | null;
  confirmedBy: string | null;
  achievedAt: string | null;
  achievedValue: number | null;
  achievedNote: string | null;
  /** Si esta meta nace para reemplazar a otra, cuál — para el "antes → después". */
  replacesGoalId: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// ── Auditoría (server/src/routes/audit.ts) ────────────────────────────────

export interface JobHealth {
  at: string;
  ok: boolean;
  detail: string;
}

export interface GateCampaign {
  id: string;
  titulo: string;
  status: ProposalStatus;
  confirmedAt: string | null;
  confirmadaPor: string | null;
  executedAt: string | null;
  finzenCampaignId: string | null;
  error: string | null;
  /** Llegó a FinZen sin que ningún socio pulsara Confirmar. Nunca debería pasar. */
  sinConfirmacion: boolean;
}

export interface AuditOverview {
  health: {
    resumenSemanal: JobHealth | null;
    indexado: JobHealth | null;
    errores24h: number;
  };
  gate: {
    borradoresCreados: number;
    sinConfirmacion: number;
    bloqueados: number;
    campanas: GateCampaign[];
    denegados: Array<{ id: string; resultSummary: string | null; createdAt: string }>;
  };
}

export interface AuditEvent {
  id: string;
  conversationId: string | null;
  conversationTitle: string | null;
  actor: string; // 'agent' | 'partner:<id>' | 'cron' | 'system'
  /** Nombre del socio cuando actor es 'partner:<id>'; null en los demás casos. */
  actorName: string | null;
  action: string;
  input: unknown;
  resultSummary: string | null;
  isError: boolean;
  durationMs: number | null;
  createdAt: string;
}

export type WeekMode = 'rolling' | 'calendar';

// Calca server/prisma/schema.prisma → model WeeklySummaryConfig.
export interface WeeklySummaryConfig {
  id: number;
  weekMode: WeekMode;
  weekStartDay: number; // 0=domingo..6=sábado — qué semana se REPORTA (solo aplica si weekMode='calendar')
  cronDay: number; // 0=domingo..6=sábado — cuándo CORRE el cron
  cronHour: number; // 0-23, hora de República Dominicana
  updatedAt: string;
  updatedBy: string | null;
}
