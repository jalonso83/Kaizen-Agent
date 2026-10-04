// ─────────────────────────────────────────────────────────────────────────
// Tipos compartidos del frontend. Los content blocks calcan los de la API de
// Anthropic (así se guardan crudos en Message.content — ver server §2.2/2.4).
// ─────────────────────────────────────────────────────────────────────────

// ── Roles y permisos (server/src/auth/permisos.ts) ────────────────────────
// Esta lista calca la del servidor. Sirve para DIBUJAR la interfaz: esconder
// una pestaña que no corresponde. La autorización de verdad la hace el
// servidor en cada request — acá no hay ninguna garantía, solo cortesía.

export type Permiso =
  | 'chat'
  | 'metas:ver'
  | 'metas:confirmar'
  | 'campanas:confirmar'
  | 'publicidad:confirmar'
  | 'auditoria:ver'
  | 'config:editar'
  | 'marketing:ver'
  | 'marketing:editar'
  | 'usuarios:gestionar';

/** Una cuenta social guardada en el apartado de Marketing. */
export interface CuentaMarketing {
  id: string;
  /** 'INSTAGRAM' | 'TIKTOK'. */
  red: string;
  /** El handle normalizado, sin arroba. Es lo que se consulta en la API. */
  usuario: string;
  /** La URL canónica, para mostrar y abrir. */
  url: string;
  etiqueta: string | null;
  /** La cuenta de FinZen (true) o la de un tercero. Cambia qué métricas se pueden esperar. */
  esPropia: boolean;
  createdAt: string;
}

// Calca server/src/services/instagramAnalisis.ts → AnalisisInstagram. Es lo
// que muestra el Dashboard y lo mismo que lee Kaizen con get_instagram_profile.
export interface PublicacionInstagram {
  id: string;
  caption: string;
  like_count: number;
  comments_count: number;
  media_type: string;
  media_product_type: string | null;
  permalink: string;
  timestamp: string;
}

export interface ResumenPublicaciones {
  cantidad: number;
  likes_promedio: number;
  comentarios_promedio: number;
  interacciones_promedio: number;
  likes_mediana: number;
  likes_total: number;
  comentarios_total: number;
  interacciones_total: number;
  por_tipo: Array<{ tipo: string; cantidad: number; likes_promedio: number; interacciones_promedio: number }>;
  top: Array<{ permalink: string; likes: number; comentarios: number; interacciones: number; tipo: string; fecha: string; caption_inicio: string }>;
  desde: string | null;
  hasta: string | null;
  piezas_por_semana: number | null;
}

export interface InsightsInstagram {
  ventana: { desde: string; hasta: string; dias: number };
  totales: Partial<Record<
    'reach' | 'views' | 'accounts_engaged' | 'total_interactions' | 'likes' | 'comments' | 'saves' | 'shares' | 'profile_links_taps' | 'follows_and_unfollows',
    number
  >>;
  seguidores_por_dia: Array<{ fecha: string; valor: number }>;
  no_disponible: Array<{ metricas: string[]; motivo: string }>;
}

export interface PuntoHistorico {
  fecha: string;
  seguidores: number;
  seguidos: number;
  publicaciones_totales: number;
  interacciones_promedio: number;
  likes_mediana: number;
  tasa_engagement_pct: number | null;
}

export interface DeltaHistorico {
  desde: string;
  dias: number;
  seguidores: number;
  publicaciones_totales: number;
  interacciones_promedio: number;
  /** Mediana de likes (Instagram) o de views (TikTok). */
  mediana: number;
  tasa_engagement_pct: number | null;
}

export interface HistoricoInstagram {
  ventana_dias: number;
  puntos: PuntoHistorico[];
  delta_7d: DeltaHistorico | null;
  delta_30d: DeltaHistorico | null;
  primera_lectura: string | null;
}

export interface VideoTiktok {
  id: string;
  titulo: string;
  descripcion: string;
  view_count: number;
  like_count: number;
  comments_count: number;
  share_count: number;
  duracion: number;
  permalink: string;
  timestamp: string;
}

export interface ResumenVideos {
  cantidad: number;
  views_total: number;
  views_promedio: number;
  views_mediana: number;
  likes_promedio: number;
  comentarios_promedio: number;
  compartidos_promedio: number;
  interacciones_promedio: number;
  duracion_promedio: number;
  top: Array<{ permalink: string; views: number; likes: number; comentarios: number; compartidos: number; fecha: string; titulo: string }>;
  desde: string | null;
  hasta: string | null;
  videos_por_semana: number | null;
}

// Calca server/src/services/tiktokAnalisis.ts → AnalisisTiktok.
export interface AnalisisTiktok {
  cuenta: { usuario: string; url: string; etiqueta: string | null; es_de_finzen: boolean };
  perfil: { nombre: string; biografia: string; verificada: boolean; seguidores: number; seguidos: number; likes_totales: number; videos_totales: number };
  tasa_engagement_views_pct: number | null;
  tasa_engagement_pct: number | null;
  resumen_videos: ResumenVideos;
  videos: VideoTiktok[];
  historico: HistoricoInstagram;
  leido_en: string;
  desde_cache: boolean;
}

export interface AnalisisInstagram {
  cuenta: { usuario: string; url: string; etiqueta: string | null; es_de_finzen: boolean };
  perfil: {
    nombre: string;
    biografia: string;
    sitio_web: string | null;
    seguidores: number;
    seguidos: number;
    publicaciones_totales: number;
    ratio_seguidores_seguidos: number | null;
  };
  tasa_engagement_pct: number | null;
  resumen_publicaciones: ResumenPublicaciones;
  publicaciones: PublicacionInstagram[];
  insights: InsightsInstagram | null;
  historico: HistoricoInstagram;
  leido_en: string;
  desde_cache: boolean;
}

export type Rol = 'ADMIN' | 'ASSISTANT' | 'USER';

export interface Partner {
  id: string;
  name: string;
  email: string;
  role: Rol;
  permisos: Permiso[];
}

/** Un socio visto desde la pantalla de gestión de usuarios. */
export interface Usuario {
  id: string;
  email: string;
  name: string;
  role: Rol;
  rolLabel: string;
  permisos: Permiso[];
  disabled: boolean;
  createdAt: string;
  createdBy: string | null;
}

export interface RolInfo {
  value: Rol;
  label: string;
  descripcion: string;
  permisos: Permiso[];
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
  /** 'chat' o 'diaria' (la corrida automática de campaña diaria). */
  origen?: string;
  finzenCampaignId: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  executedAt: string | null;
  error: string | null;
  createdAt: string;
}

// Calca server/prisma/schema.prisma → model AdProposal (2026-10-04): la
// tarjeta de un anuncio en Meta que promociona un post de Instagram.
export type AdProposalStatus = 'PROPOSED' | 'CONFIRMED' | 'CREATING' | 'CREATED_PAUSED' | 'ERROR' | 'REJECTED' | 'SUPERSEDED' | 'EXPIRED';
export type ObjetivoAnuncio = 'OUTCOME_TRAFFIC' | 'OUTCOME_ENGAGEMENT' | 'OUTCOME_AWARENESS';

export interface AdProposal {
  id: string;
  conversationId: string | null;
  status: AdProposalStatus;
  /** 'chat' o 'programada' (la corrida de la publicidad automática). */
  origen: string;
  mediaId: string;
  mediaPermalink: string;
  mediaTipo: string | null;
  mediaCaption: string | null;
  nombre: string;
  objetivo: ObjetivoAnuncio;
  urlDestino: string | null;
  presupuestoDiario: number;
  moneda: string;
  duracionDias: number;
  segmentacion: { paises: string[]; edadMin: number; edadMax: number; categoriaFinanciera: boolean };
  racional: string;
  medicion: string;
  metaCampaignId: string | null;
  inicio: string | null;
  fin: string | null;
  error: string | null;
  confirmedAt: string | null;
  createdAt: string;
  /** Link a la campaña en Ads Manager, cuando ya existe. Lo arma el servidor. */
  adsManager?: string | null;
}

// Calca server/prisma/schema.prisma → model MetaAdsConfig.
export interface MetaAdsConfig {
  enabled: boolean;
  diasSemana: number[];
  cronHour: number;
  conversationId: string | null;
  presupuestoDiario: number;
  duracionDias: number;
  objetivo: ObjetivoAnuncio;
  urlDestino: string | null;
  paises: string[];
  edadMin: number;
  edadMax: number;
  categoriaFinanciera: boolean;
  rotacionDias: number;
}

export interface MetaAdsVista {
  config: MetaAdsConfig | null;
  conversacion: { id: string; title: string; esMia: boolean } | null;
  /** META_MAX_DAILY_BUDGET_USD: la pantalla no deja pedir más. */
  topeDiarioUsd: number;
  /** Qué falta para poder crear en Meta (variables, escritura); null si nada. */
  falta: string | null;
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
  /** Confirmada por el job de la campaña diaria en modo directo (configurado por un ADMIN), no por un clic. */
  automatica: boolean;
}

/** Una tarjeta PROPOSED que espera decisión, vista desde Auditoría. */
export interface PropuestaPendiente {
  id: string;
  titulo: string;
  mensaje: string;
  segmento: string;
  segmentCount: number | null;
  origen: string;
  createdAt: string;
  conversacion: { id: string; title: string };
  /** Se puede decidir desde acá: es de la campaña diaria o de una conversación propia. */
  decidible: boolean;
}

// ── Metas (server/src/routes/goalsHistory.ts) ─────────────────────────────

/** Una campaña vista desde la meta bajo la que se propuso. */
export interface GoalCampaign {
  id: string;
  titulo: string;
  status: ProposalStatus;
  messageType: string | null;
  executedAt: string | null;
  finzenCampaignId: string | null;
  createdAt: string;
  /** El borrador se creó de verdad en FinZen (no quedó en propuesta o rechazo). */
  llegoAFinzen: boolean;
}

export interface GoalHistoryEntry {
  id: string;
  resumen: string;
  metricLabel: string;
  target: number;
  unit: string;
  direction: 'gte' | 'lte';
  rationale: string;
  status: GoalStatus;
  confirmedAt: string | null;
  confirmadaPor: string | null;
  achievedAt: string | null;
  achievedValue: number | null;
  achievedNote: string | null;
  createdAt: string;
  /** Cuándo dejó de estar vigente. Null si sigue activa o nunca lo estuvo. */
  hasta: string | null;
  reemplazaA: string | null;
  conversacion: { id: string; title: string } | null;
  campanas: GoalCampaign[];
  propuestas: number;
  publicadas: number;
}

export interface GoalHistory {
  metas: GoalHistoryEntry[];
  /** Campañas anteriores a que existieran las metas: no se les asigna ninguna. */
  campanasSinMeta: number;
}

export interface AuditOverview {
  health: {
    resumenSemanal: JobHealth | null;
    indexado: JobHealth | null;
    errores24h: number;
  };
  /** La meta vigente, como contexto. El historial completo vive en la pantalla de Metas. */
  meta: { resumen: string; confirmedAt: string | null; confirmadaPor: string | null } | null;
  gate: {
    borradoresCreados: number;
    sinConfirmacion: number;
    bloqueados: number;
    campanas: GateCampaign[];
    denegados: Array<{ id: string; resultSummary: string | null; createdAt: string }>;
    /** Borradores creados por confirmación automática (campaña diaria en modo directo). */
    automaticas: number;
    pendientes: PropuestaPendiente[];
    /** Tarjetas de anuncio en Meta: pendientes, creadas en pausa y fallidas. */
    anuncios?: Array<AdProposal & { conversacion: { id: string; title: string } | null; decidible: boolean }>;
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

// Calca server/prisma/schema.prisma → model DailyCampaignConfig (+ la conversación resuelta).
export interface DailyCampaignConfig {
  enabled: boolean;
  cronHour: number; // 0-23, hora de RD
  /** 'tarjeta' (espera Confirmar/Rechazar) o 'directo' (el job confirma y crea el borrador; FinZen lo aprueba en su panel). */
  modo: 'tarjeta' | 'directo';
  conversationId: string | null;
  rotacionDias: number;
  conversacion: { id: string; title: string; esMia: boolean } | null;
}

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
