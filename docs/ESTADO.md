# ESTADO.md — Bitácora viva de Kaizen

> **Propósito:** que cualquier persona o agente de IA que entre al proyecto sepa
> en 2 minutos **dónde estamos, qué está hecho y qué sigue** — sin tener que
> reconstruir la historia. La especificación completa vive en
> [`PRD_Kaizen.md`](PRD_Kaizen.md); este documento es la bitácora.
>
> **Regla:** quien termine una sesión de trabajo que cambie el estado del
> proyecto (deploy, credencial nueva, feature terminada, decisión tomada)
> **actualiza este documento en el mismo commit**. Fechas siempre absolutas
> (YYYY-MM-DD).

---

## 📍 Dónde estamos (actualizado: 2026-07-12)

**FASE 0 COMPLETADA** (salvo login de socios, movido a Fase 1).
**Siguiente paso: FASE 1 — el agente interno** (loop de Claude + tools + chat de socios). Nada de Fase 1 está empezado, pero **el diseño técnico completo ya está escrito: [`DISENO_FASE1.md`](DISENO_FASE1.md)** (producido por una mesa de 3 arquitectos + síntesis, 2026-07-12) — esquema de BD, rutas, loop, las 9 tools, gate de confirmación, system prompt redactado y plan semana a semana. El pasante arranca por ahí. Además, **los 5 skills de marketing de Kaizen ya están escritos** en `server/skills/` (adaptados de repos MIT al contexto FinZen) — mecánica y catálogo en [`SKILLS.md`](SKILLS.md).

---

## Infraestructura (lo que ya existe y funciona)

| Cosa | Valor / dónde |
|---|---|
| Deploy Kaizen | Railway — `https://kaizen-agent-production.up.railway.app` (`/health` OK). Root Directory = `server`, build `npm install && npm run build`, start `npm start` |
| Backend FinZen (Agent API) | `https://finzenai-backend-production.up.railway.app` — encendida y validada E2E (2026-07-10) |
| Repo | `github.com/jalonso83/Kaizen-Agent` — `main` protegida; trabajo en ramas + PR |
| Proyecto Google Cloud | `kaizen-agent-502219` (cuenta Google de FinZen) — Drive API habilitada |
| Service Account Drive | `kaizen-drive@kaizen-agent-502219.iam.gserviceaccount.com` — sin roles de proyecto; solo ve las 2 carpetas compartidas |
| Carpeta Cerebro (lectura) | `DRIVE_CEREBRO_KAIZEN`, ID `18n-WlmoBSFXcNrz0HsKlTLfraOdmm_iG` — permiso **Lector**. Estructura: `00-nucleo` · `10-decisiones` · `20-ideas` · `30-ingesta` · `40-loops` · `50-kaizen` · `60-referencias` · `README.md` |
| Carpeta Contenidos (escritura) | `DRIVE_CONTENIDOS_KAIZEN`, ID `1EPT2Ra_zZLCCnq_YVj_EXafqNOaVNoZM` — permiso **Editor**. Estructura: `assets` · `reels` · `guiones` · `carruseles` · `README.md` |

### Variables de entorno en Railway (servicio Kaizen)

Todas configuradas con valores reales (los valores NUNCA se escriben aquí ni en el repo):

`FINZEN_API_URL` · `FINZEN_AGENT_KEY` · `ANTHROPIC_API_KEY` · `AGENT_ENABLED` ·
`DRIVE_CEREBRO_FOLDER_ID` · `DRIVE_CONTENIDOS_FOLDER_ID` · `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`

Para desarrollo local: `.env` desde `.env.example`; para Drive se puede usar
`GOOGLE_SERVICE_ACCOUNT_PATH` (ruta al JSON) en vez de la base64. Las
credenciales las entrega FinZen por canal privado.

Pendientes de Fase 1: `DATABASE_URL`, `JWT_SECRET`. De Fase 2: las de Meta.

---

## Historial de hitos

### 2026-07-12 — Fase 0 cerrada
- Service Account de Google creada (proyecto `kaizen-agent-502219`, cuenta de FinZen); las carpetas de Drive viven en **otra** cuenta Google y están compartidas cross-account con la SA — funciona sin problema.
- `drive.ts`/`config.ts`: soporte de credenciales por `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` (para Railway, donde no hay filesystem) además del path local. **Ambos modos probados contra el Drive real** (listan los 8 elementos del Cerebro). Commit `c5a3f19`.
- Variable base64 configurada en Railway; deploy arriba.

### 2026-07-11 — Deploy de Kaizen en Railway
- Servicio creado desde el repo (Root Directory = `server`), dominio generado, `/health` verificado OK.
- Todas las env vars requeridas configuradas (Anthropic primero con placeholder, luego key real).
- Lección aprendida: en Railway los cambios de Variables quedan **staged** hasta el clic en "Apply changes"/Deploy — sin eso el contenedor no las ve.

### 2026-07-10 — Agent API validada E2E + esqueleto
- FinZen encendió la Agent API en producción (`AGENT_API_KEY` en su Railway). Batería completa OK: auth 401/503, catálogo de 5 segmentos, evaluación contra BD real, KPIs reales, creación de propuesta `PENDING_APPROVAL`, aprobación/rechazo humano en el panel de FinZen.
- Esqueleto de Kaizen commiteado: Express `/health`, `config.ts`, `clients/finzenApi.ts` (tipado con los contratos del PRD §4), `clients/drive.ts`, `npm run check`.

### 2026-07-09 — Lado FinZen listo
- Los 3 endpoints de la Agent API implementados en el backend de FinZen.
- UI de aprobación en el panel de FinZen (propuestas del agente en ámbar, aprobar/rechazar/enviar).

---

## ✅ Hecho / ⏳ Pendiente

**Hecho:**
- [x] Repo + esqueleto (server, config validada al boot, clientes FinZen/Drive, smoke tests)
- [x] Agent API de FinZen implementada, encendida y validada E2E
- [x] Deploy de Kaizen en Railway con `/health` OK
- [x] Credenciales reales: FinZen key, Anthropic key, Service Account de Drive
- [x] Acceso a Drive verificado (Cerebro lectura, Contenidos escritura)

**Pendiente (Fase 1 — ver PRD §5/Fase 1 para el detalle):**
- [ ] BD propia (PostgreSQL en Railway): conversaciones, propuestas, audit log
- [ ] Loop de Claude con tool-use (`claude-opus-4-8`, tool runner del SDK)
- [ ] Las 6 tools: `get_kpis`, `list_segments`, `evaluate_segment`, `create_campaign_draft` (con gate de confirmación), `search_cerebro`, `save_content_draft`
- [ ] System prompt de Kaizen
- [ ] Chat backend (SSE) + web de socios (React) + login propio (JWT)
- [ ] Indexado del Cerebro (job cada 6h, búsqueda keyword — sin vector store)
- [ ] Resumen semanal automático en Drive

**Pendiente (Fase 2):** Meta Ads — requiere Fase 1 estable ≥ 2 semanas + aprobación explícita de FinZen.

---

## Decisiones tomadas (que no están en el PRD o lo matizan)

- **Login de socios se construye en Fase 1** junto con el chat (no tenía sentido un login sin pantalla detrás).
- **Credenciales de Drive por base64 en Railway** (`GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`); el path a archivo solo para local.
- **Proyecto de Google Cloud separado** (`kaizen-agent-502219`) — no se reutilizó el proyecto `finzen-ai` (que maneja el OAuth del email sync) para aislar credenciales.
- **La API key de Anthropic es de Console** (facturación por tokens, independiente del plan Max de claude.ai). Recomendado: key separada para el dev local del pasante + límite de gasto en Console.
