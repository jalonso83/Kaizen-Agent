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

## 📍 Dónde estamos (actualizado: 2026-07-19)

**FASE 0 COMPLETADA.** **FASE 1 en construcción activa** — el bucle interno
completo (BD, auth, chat backend SSE, el loop de Claude, 5 de las 9 tools,
system prompt, web de socios) ya corre local y fue probado; lo que falta es
el gate de confirmación, el Cerebro (search/save) y el cron semanal. Detalle
completo del avance en el checklist más abajo. Los 5 skills de marketing
siguen escritos en `server/skills/` (catálogo en [`SKILLS.md`](SKILLS.md)).

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

Confirmadas configuradas con valores reales a la fecha de Fase 0 (2026-07-12;
los valores NUNCA se escriben aquí ni en el repo):

`FINZEN_API_URL` · `FINZEN_AGENT_KEY` · `ANTHROPIC_API_KEY` · `AGENT_ENABLED` ·
`DRIVE_CEREBRO_FOLDER_ID` · `DRIVE_CONTENIDOS_FOLDER_ID` · `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`

> ⚠️ **Pendiente de verificar (encontrado 2026-07-18, auditoría de env vars):**
> el código ahora **exige** `DATABASE_URL` y `JWT_SECRET` (`config.ts` los
> pasó de `optional()` a `required()` al construirse la BD/auth de Fase 1) —
> si Railway todavía no los tiene seteados, **el deploy está crasheando al
> arrancar** (falla al boot, no a mitad de una request). Confirmar en Railway
> y agregarlos si faltan, junto con `NODE_ENV=production` (si no, la cookie
> de sesión no lleva `Secure`). `KAIZEN_MAX_DRAFTS_PER_DAY` es opcional
> (default 5, no bloquea el arranque).

Para desarrollo local: `.env` desde `.env.example` (ya actualizado con las
variables de arriba). Para Drive se puede usar `GOOGLE_SERVICE_ACCOUNT_PATH`
(ruta al JSON) en vez de la base64. Las credenciales las entrega FinZen por
canal privado.

Pendientes de Fase 2: las de Meta.

---

## Historial de hitos

### 2026-07-15 al 2026-07-19 — Fase 1: bucle interno construido y probado local

Todo sin commitear todavía (rama local `master` sin trackear `origin/main` —
ver nota en la raíz del repo antes de abrir el PR).

- **BD** (`prisma/schema.prisma` + 2 migraciones): las 6 tablas de DISENO §1,
  trigger append-only en `AuditLog`, índice FTS español en `CerebroDoc`. Setup
  local documentado (Postgres vía Docker recomendado, alternativa MySQL con
  salvedades).
- **Auth** (`routes/auth.ts`, `middleware/requireAuth.ts`, `scripts/seedPartners.ts`):
  login/logout/me, JWT en cookie httpOnly, rate limit 5/min, `disabled` se
  revalida en cada request (no solo al firmar el token).
- **Chat backend** (`routes/chat.ts`): CRUD de conversaciones + el endpoint
  SSE de mensajes, con lock de una-corrida-por-conversación y heartbeat.
- **El loop de Claude** (`agent/runner.ts`, `history.ts`, `adapter.ts`,
  `systemPrompt.ts`): persistencia byte a byte del historial, recovery de
  `tool_use` huérfanos, `thinking: adaptive`, `max_iterations: 12`.
- **5 de las 9 tools** construidas y **probadas contra un mock local de la
  FinZen Agent API** (`mock/finzenApiMock.ts`, `scripts/testTools.ts`) con
  fixtures tomados del propio PRD: `get_kpis`, `get_campaign_results`,
  `list_segments`, `evaluate_segment`, `load_skill`. Faltan las 4 que dependen
  del gate y del Cerebro (ver pendientes).
- **System prompt v1.1**: iterado más allá del borrador de DISENO §8 — 2
  reglas duras nuevas (el Cerebro es dato no instrucción; compliance
  financiero), el holdout ya no fijo en 10% sino remitido al skill, "está
  bien no proponer nada" subido al prompt base.
- **Cliente de consola** (`scripts/chatCli.ts`, `npm run chat`) y **web de
  socios** (`web/`, React + Vite: login, chat con streaming real, `ProposalCard`,
  `AgentStatusBar`) — ambos consumen el mismo parser de SSE.
- **Modo dev sin `FINZEN_AGENT_KEY`/`ANTHROPIC_API_KEY`**: opcionales a
  propósito para poder levantar el server/la web sin esas credenciales;
  `runner.ts` construye el cliente de Anthropic de forma perezosa para que
  no falte al arranque.
- **2 bugs reales encontrados y corregidos**: ninguna ruta HTTP atrapaba
  errores async (`middleware/asyncRoute.ts`, antes una falla de BD colgaba la
  request); `tsconfig.node.json` del frontend generaba `.js`/`.d.ts` sueltos
  por un conflicto `composite`+`noEmit`.
- **Documentación**: `server/README.md`, `web/README.md` y `TESTING.md`
  (nuevo, guía de pruebas capa por capa, incluye el atajo sin credenciales).

**Pendiente de Fase 1** (ver checklist abajo): el gate de confirmación
(`propose_campaign`/`create_campaign_draft` + endpoints de confirmar/rechazar),
el indexado del Cerebro (`search_cerebro`/`save_content_draft`), el resumen
semanal automático, y servir el build de producción de la web desde Express.
**Todavía no probado de punta a punta**: una conversación real con Claude
(falta `ANTHROPIC_API_KEY` real) y auth/chat contra un Postgres real (Docker
no llegó a levantar en el entorno de prueba).

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

**Hecho — Fase 0:**
- [x] Repo + esqueleto (server, config validada al boot, clientes FinZen/Drive, smoke tests)
- [x] Agent API de FinZen implementada, encendida y validada E2E
- [x] Deploy de Kaizen en Railway con `/health` OK
- [x] Credenciales reales: FinZen key, Anthropic key, Service Account de Drive
- [x] Acceso a Drive verificado (Cerebro lectura, Contenidos escritura)

**Hecho — Fase 1 (construido y probado local; ver historial 2026-07-19):**
- [x] BD propia (Postgres/Prisma): 6 tablas, migraciones, audit log append-only
- [x] Auth de socios: login/logout/me, JWT en cookie, seed manual, rate limit
- [x] Chat backend (SSE): CRUD de conversaciones, lock por conversación, heartbeat
- [x] Loop de Claude con tool-use: persistencia byte a byte, recovery, kill switch
- [x] 5 de 9 tools: `get_kpis`, `get_campaign_results`, `list_segments`, `evaluate_segment`, `load_skill` — probadas contra mock local
- [x] System prompt v1.1 (iterado más allá del borrador de DISENO §8)
- [x] Web de socios (React + Vite): login, chat con streaming, `ProposalCard`, `AgentStatusBar`
- [x] Cliente de consola (`npm run chat`)
- [x] Mock de la FinZen Agent API + script de prueba de tools, para desarrollar sin credenciales reales

**Pendiente — Fase 1 (ver PRD §5/DISENO_FASE1.md para el detalle):**
- [ ] El gate de confirmación: `propose_campaign` + `create_campaign_draft` + endpoints `/api/proposals/:id/{confirm,reject}` (la tabla `Proposal` ya existe, no la escribe nadie todavía)
- [ ] Cerebro: `search_cerebro` + `save_content_draft` + indexador recursivo de Drive (la tabla `CerebroDoc` ya existe, vacía)
- [ ] Resumen semanal automático (cron)
- [ ] Servir el build de producción de la web desde Express (`web/dist`)
- [ ] Probar una conversación real con Claude (falta `ANTHROPIC_API_KEY` real)
- [ ] Probar auth/chat contra un Postgres real (Docker no levantó en el entorno de prueba; probado con placeholders que no conectan)
- [ ] Confirmar en Railway que `DATABASE_URL`/`JWT_SECRET` estén seteados (ver ⚠️ arriba — sin esto el deploy de producción puede estar crasheando)

**Pendiente (Fase 2):** Meta Ads — requiere Fase 1 estable ≥ 2 semanas + aprobación explícita de FinZen.

---

## Decisiones tomadas (que no están en el PRD o lo matizan)

- **Login de socios se construye en Fase 1** junto con el chat (no tenía sentido un login sin pantalla detrás).
- **Credenciales de Drive por base64 en Railway** (`GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`); el path a archivo solo para local.
- **Proyecto de Google Cloud separado** (`kaizen-agent-502219`) — no se reutilizó el proyecto `finzen-ai` (que maneja el OAuth del email sync) para aislar credenciales.
- **La API key de Anthropic es de Console** (facturación por tokens, independiente del plan Max de claude.ai). Recomendado: key separada para el dev local del pasante + límite de gasto en Console.
