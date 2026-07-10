# PRD Técnico — Kaizen, el Agente de Crecimiento de FinZen AI

**Documento para el pasante** · Versión 1.2 · 2026-07-10
**Repositorio del proyecto:** `github.com/jalonso83/Kaizen-Agent` (privado — FinZen es dueño; el pasante trabaja como colaborador, en ramas + Pull Request)
**Basado en:** "El ecosistema de crecimiento de FinZen AI" (arquitectura, 2026-07-06)
**Responsable del proyecto:** José Luis (FinZen AI)

---

## 1. Resumen

Vas a construir a **Kaizen**, un agente de crecimiento autónomo y conversacional para FinZen AI: un sistema que lee los KPIs del negocio, conversa con los socios en lenguaje natural, encuentra segmentos de usuarios, y propone campañas de marketing (internas por push/mensajería y externas por Meta Ads). **Un humano siempre aprueba antes de que se envíe o publique nada.**

Kaizen es un **proyecto 100% independiente**: repositorio propio (`Kaizen-Agent`, creado y administrado por FinZen; tú trabajas como colaborador), deploy propio, credenciales propias. **No tocas el código de FinZen ni su base de datos.** Toda la comunicación con FinZen pasa por una Agent API con API Key que FinZen te entrega.

```
┌─────────────────────────────────────────────────────────┐
│                    TU PROYECTO (el agente)               │
│                                                          │
│  Chat con socios ←→ Orquestador (loop de Claude)        │
│                          │                               │
│         ┌────────────────┼──────────────┬──────────┐    │
│         ▼                ▼              ▼          ▼    │
└─────────┼────────────────┼──────────────┼──────────┼────┘
          │                │              │          │
   FinZen Agent API   Google Drive   Anthropic    Meta Graph
   (KPIs, segmentos,  (Cerebro RAG,  (Claude,     API (Fase 2:
   borradores de      guardar        Messages     ads y spend)
   campaña)           contenido)     API)
```

### El contrato con FinZen

> **Una API Key + 3 endpoints. Todo lo demás es tu mundo.**

| Endpoint | Dirección | Para qué |
|---|---|---|
| `GET /api/agent/kpis` | Solo lectura | Métricas estructuradas del negocio |
| `GET /api/agent/segments` | Solo lectura (agregados, sin PII) | Segmentos curados de usuarios |
| `POST /api/agent/campaigns` | Escritura solo-borrador | Crear campañas que un humano aprueba en el panel de FinZen |

---

## 2. Alcance y no-alcance

### Sí (tu responsabilidad)

- El cerebro del agente: Claude (Anthropic Messages API) + tool-use + el loop del objetivo.
- Cliente HTTP contra la FinZen Agent API (los 3 endpoints).
- Conexión con Google Drive: leer la carpeta *Cerebro* (base de conocimiento) y guardar contenido generado en la carpeta de contenidos.
- Interfaz conversacional con los socios (chat web propio con login propio).
- Toda la lógica de análisis de KPIs y diseño de campañas.
- Fase 2: integración con la Meta Marketing API (leer spend, crear campañas en pausa/borrador).
- Guardarraíles: aprobación humana, límites, logs, kill switch.

### No (fuera de tu alcance)

- **No** construyes los 3 endpoints de FinZen — los construye FinZen (ver §4).
- **No** tienes acceso a la base de datos de FinZen ni a datos personales (PII).
- **No** envías campañas: solo creas borradores; el envío lo aprueba y ejecuta FinZen desde su propio panel.
- **No** publicas ads en vivo sin aprobación: en Meta todo se crea en estado `PAUSED` y con topes.
- **No** modificas la app móvil, el backend de FinZen ni la landing.

---

## 3. Stack recomendado

| Capa | Tecnología | Por qué |
|---|---|---|
| Lenguaje | **Node.js 20+ / TypeScript** | Coincide con el ecosistema FinZen; SDK oficial de Anthropic maduro |
| Framework backend | Express o Fastify | Simple, suficiente para el chat + orquestador |
| LLM | **Anthropic SDK `@anthropic-ai/sdk`** · modelo `claude-opus-4-8` | Tool-use nativo, adaptive thinking |
| Frontend chat | React + Vite (o Next.js) | Chat simple con streaming |
| Base de datos propia | PostgreSQL (o SQLite en Fase 0) | Conversaciones, propuestas, logs de auditoría |
| Drive | `googleapis` (Node) con Service Account | Lectura del Cerebro + escritura de contenidos |
| Meta (Fase 2) | Meta Graph API v21+ (`facebook-nodejs-business-sdk` o REST directo) | Ads y spend |
| Deploy | Railway (o Render/Fly.io) | Mismo proveedor que FinZen; deploy por push |

Python + FastAPI es aceptable si lo dominas mejor — la arquitectura no cambia. Los ejemplos de este PRD están en TypeScript.

---

## 4. Prerequisitos — responsabilidad de FinZen (NO son tareas del pasante)

> ✅ **Actualización 2026-07-09: los 3 endpoints ya están IMPLEMENTADOS en el backend de FinZen.** Los contratos de abajo son los definitivos (reflejan la implementación real). Base URL: `https://finzenai-backend-production.up.railway.app`.
>
> ✅ **Actualización 2026-07-10: la Agent API está ENCENDIDA en producción y el circuito completo fue validado de punta a punta** — auth (401/503), catálogo, evaluación de los 5 segmentos contra la BD real, KPIs con datos reales, creación de propuesta `PENDING_APPROVAL`, revisión en el panel de FinZen (rationale + alcance en vivo) y rechazo/aprobación humana. La `FINZEN_AGENT_KEY` te la entrega FinZen por canal privado — no está en ningún repo. Además existe el flujo de aprobación en el panel: tus propuestas aparecen como "Propuesta del agente" (ámbar, ícono 🤖) y un humano las aprueba, rechaza o envía desde ahí.

### 4.1 API Key del agente

- Header de autenticación: `x-agent-key: <API_KEY>` (env var `AGENT_API_KEY` en Railway).
- Permisos mínimos: leer KPIs/segmentos (solo agregados, nunca PII), crear borradores `PENDING_APPROVAL`. Estructuralmente no puede enviar: el motor de envío exige estado `DRAFT`, que solo un admin asigna al aprobar.
- Rate limit: 30 req/min. Kill switch: si FinZen borra la env var, toda la Agent API responde 503.
- Errores estándar: `401` key inválida/faltante, `503` API deshabilitada, `429` límite de borradores diarios.

### 4.2 Contrato del endpoint de KPIs

```
GET /api/agent/kpis?from=2026-06-01&to=2026-06-30
Headers: x-agent-key
```

`from`/`to` opcionales (default: últimos 30 días). Respuesta real:

```json
{
  "period": { "from": "...", "to": "..." },
  "users": { "total": 2100, "new_registrations": 412, "registration_change_pct": 12.5, "activated": 205 },
  "engagement": { "dau": 310, "mau": 890, "retention_d1_pct": 42.1, "retention_d7_pct": 31.0, "retention_d30_pct": 18.2 },
  "revenue": {
    "mrr_usd": 1480.0,
    "plan_distribution": { "FREE": 1990, "PREMIUM": 96, "PRO": 12 },
    "churn_rate_pct": 3.2,
    "free_to_paid_rate_pct": 4.8,
    "trials": { "active": 22, "started": 61, "conversion_rate_pct": 23.0 }
  },
  "acquisition": {
    "totals": { "visitors": 5400, "leads": 800, "registrations": 412, "subscriptions": 30 },
    "by_source": [
      { "source": "meta", "campaign": "julio_ahorro", "visitors": 1200, "leads": 300, "registrations": 120,
        "subscriptions": 9, "revenue_usd": 54.0, "cost_usd": 222.0, "conversion_rate_pct": 10.0, "cac_usd": 1.85 }
    ]
  },
  "campaigns": [
    { "id": "cmp_123", "title": "...", "surface": "push", "sent_at": "...", "holdout_pct": 10,
      "exposed": 1200, "holdout": 130, "impressions": 340, "clicks": 88,
      "exposed_tx_rate_pct": 18.4, "holdout_tx_rate_pct": 12.1, "lift_pts": 6.3 }
  ]
}
```

Notas: los porcentajes vienen como puntos (ej. `31.0` = 31%). `campaigns` incluye la medición causal (lift en puntos porcentuales vs. grupo control/holdout) de los broadcasts enviados en el período (máx. 20). `cac_usd` es `null` si la campaña no tiene costo registrado.

### 4.3 Contrato del endpoint de segmentos (capa semántica)

Los segmentos son **curados por FinZen en código** — el agente nunca ejecuta SQL. Solo devuelven conteos, nunca datos personales.

```
GET /api/agent/segments                      → catálogo (leer en vivo: puede crecer)
GET /api/agent/segments/{slug}?param=valor   → evaluación (conteo)
```

**Slugs disponibles (v1):** `never_activated`, `dormant`, `active`, `budget_exceeded`, `trial_ending`.

**Todos los segmentos aceptan parámetros estándar combinables** (así "los dormidos FREE de iOS" no necesita un segmento nuevo):
- `plans` — CSV de `FREE,PREMIUM,PRO` (default: todos)
- `platforms` — CSV de `IOS,ANDROID` (default: ambas)
- `country` — país exacto (default: todos)
- `days` — en `dormant`/`active` (ventana de actividad, default 14) y `trial_ending` (días al vencimiento, default 3)

Catálogo (shape real):

```json
{
  "segments": [
    { "slug": "budget_exceeded", "name": "Presupuesto excedido",
      "description": "Usuarios con al menos un presupuesto vigente cuyo gasto (spent) superó el monto (amount).",
      "params": [
        { "name": "plans", "type": "csv", "required": false, "default": "FREE,PREMIUM,PRO", "description": "..." },
        { "name": "platforms", "type": "csv", "required": false, "default": "IOS,ANDROID", "description": "..." },
        { "name": "country", "type": "string", "required": false, "description": "..." }
      ] }
  ]
}
```

Evaluación (`GET /api/agent/segments/budget_exceeded?plans=FREE`):

```json
{
  "slug": "budget_exceeded",
  "count": 1240,
  "opted_out": 85,
  "params_used": { "plans": "FREE" },
  "evaluated_at": "2026-07-09T14:00:00Z"
}
```

`count` ya descuenta los usuarios con opt-out de marketing (`opted_out` dice cuántos se excluyeron) — es el alcance real de una campaña. Un slug inexistente devuelve `404` con `available_slugs`.

**Segmentos nuevos:** si el agente necesita uno que no existe ni se puede componer, lo registra como solicitud (ver §1.7) y FinZen lo agrega al catálogo en código (~1 deploy); el agente lo verá automáticamente en el catálogo.

### 4.4 Contrato del endpoint de campañas (solo borrador)

```
POST /api/agent/campaigns
Headers: x-agent-key
```

```json
{
  "title": "Reajusta tu presupuesto con Zenio",
  "message": "Tu presupuesto de Comida se pasó. Zenio te ayuda a reajustarlo en 10 segundos.",
  "segment_slug": "budget_exceeded",
  "segment_params": { "plans": "FREE,PREMIUM" },
  "rationale": "Segmento de 1,240 usuarios con presupuesto excedido; campañas similares mostraron lift de 6 pts.",
  "surface": "push",
  "holdout_pct": 10
}
```

Reglas de validación: `title` ≤ 100 chars, `message` ≤ 200 chars, `rationale` obligatorio (≥ 10 chars — el agente siempre justifica con datos), `segment_slug` debe existir en el catálogo. Opcionales: `surface` (`push|slot|both`, default `push`), `holdout_pct` (0-100, default 10).

Respuesta: `201 { "id": "...", "status": "PENDING_APPROVAL", "message": "..." }`.

Flujo de aprobación: `PENDING_APPROVAL` → (admin aprueba en el panel de FinZen) → `DRAFT` → (admin envía con confirmación) → `SENDING/SENT`. Rechazo → `REJECTED`. **El agente jamás dispara el envío** — el motor exige `DRAFT` y el agente solo puede crear `PENDING_APPROVAL`.

Guardarraíl backend: máximo **5 borradores/día** (configurable con `AGENT_MAX_DRAFTS_PER_DAY`); al superarlo responde `429` — el agente debe manejarlo y avisar al socio.

### 4.5 Google Drive

- FinZen crea y cura la carpeta **`Cerebro`** (decisiones, análisis, marca, tono de voz) y una carpeta **`Contenidos`** (donde el agente guarda borradores de contenido).
- FinZen comparte ambas carpetas con el email de la **Service Account** que el pasante genere (el pasante crea el proyecto de Google Cloud y la service account; FinZen solo comparte las carpetas).

### 4.6 Otros

- **API Key de Anthropic**: FinZen la provee (o presupuesto para ella).
- **Fase 2 — Meta**: FinZen entrega System User Token con permisos `ads_read` primero y `ads_management` después, sobre su Business Manager, junto con el `ad_account_id`.
- Documentación de los 3 endpoints publicada (puede ser un README + esta spec).

---

## 5. Fases del proyecto

```
FASE 0 (setup) → FASE 1 (agente interno) → FASE 2 (Meta) → FASE 3 (visión, fuera de alcance)
```

---

## FASE 0 — Setup del proyecto (≈ 1 semana)

**Objetivo:** esqueleto desplegado y conexiones verificadas.

> ✅ **Actualización 2026-07-10: el repo `Kaizen-Agent` ya existe con el esqueleto inicial** — estructura `server/` + `web/`, TypeScript, `config.ts` (validación de env vars al boot), cliente completo de la FinZen Agent API (`clients/finzenApi.ts`, tipado según los contratos del §4), cliente de Drive, y `npm run check` (smoke tests de las 3 conexiones). Tu Fase 0 arranca en la tarea 2: clonar, configurar `.env` y verificar conexiones. Lee los README del repo (raíz, `server/src/agent/`, `web/`).

### Tareas

1. **Repo + estructura.** ~~Crear el repo~~ **Ya existe** (`github.com/jalonso83/Kaizen-Agent`, esqueleto incluido). Estructura:
   ```
   Kaizen-Agent/
   ├── server/          # Express: API del chat + orquestador del agente
   │   ├── src/
   │   │   ├── agent/       # (Fase 1) loop de Claude, tools, system prompt
   │   │   ├── clients/     # finzenApi.ts ✅ · drive.ts ✅ · meta.ts (F2)
   │   │   ├── routes/      # (Fase 1) /chat, /auth, /proposals — /health ✅
   │   │   ├── db/          # (Fase 1) Prisma o Drizzle: conversaciones, propuestas, audit log
   │   │   ├── config.ts    # ✅ env vars validadas al arrancar
   │   │   └── check.ts     # ✅ smoke tests de conexiones (npm run check)
   ├── web/             # (Fase 1) chat de socios (React)
   └── README.md        # ✅
   ```
2. **Variables de entorno** (validadas al boot; el server no arranca si falta una):
   `ANTHROPIC_API_KEY`, `FINZEN_API_URL`, `FINZEN_AGENT_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` (o path), `DRIVE_CEREBRO_FOLDER_ID`, `DRIVE_CONTENIDOS_FOLDER_ID`, `DATABASE_URL`, `JWT_SECRET`. Fase 2: `META_SYSTEM_TOKEN`, `META_AD_ACCOUNT_ID`, `META_MAX_DAILY_BUDGET_USD`.
3. **Google Cloud**: crear proyecto, habilitar Drive API, crear Service Account, descargar JSON, pasar el email de la SA a FinZen para que comparta las carpetas.
4. **Smoke tests de conexión** (script `npm run check`):
   - `GET {FINZEN_API_URL}/api/agent/kpis` con la key → 200.
   - Listar archivos de la carpeta Cerebro por Drive API → ≥ 0 archivos.
   - Llamada mínima a Anthropic (`claude-opus-4-8`, "ping") → respuesta.
5. **Deploy en Railway** con `/health` respondiendo.
6. **Login de socios**: usuarios/contraseña propios sembrados a mano (2–3 socios), JWT en cookie httpOnly. No es el login de la app FinZen.

### Criterios de aceptación Fase 0

- [ ] `npm run check` pasa las 3 conexiones en el entorno desplegado.
- [ ] Un socio puede hacer login y ver una pantalla de chat vacía.
- [ ] Ninguna credencial hardcodeada; todo por env vars.

---

## FASE 1 — Agente interno (≈ 4–6 semanas) · **Riesgo bajo, empezar aquí**

**Objetivo:** el bucle cerrado interno funciona de punta a punta: un socio pide algo en lenguaje natural → el agente analiza KPIs y segmentos → propone una campaña interna → crea el borrador en FinZen → un humano lo aprueba en el panel de FinZen → FinZen la envía con su broadcast y mide el lift.

### 1.1 El cerebro: loop de Claude con tool-use

Usa el **tool runner** del SDK de Anthropic (maneja el loop automáticamente) con `claude-opus-4-8` y adaptive thinking. Cada mensaje del socio dispara una corrida del agente con el historial de la conversación.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

const client = new Anthropic();

const getKpis = betaTool({
  name: "get_kpis",
  description:
    "Obtiene los KPIs del negocio FinZen (adquisición, activación, engagement, retención, ingresos, campañas pasadas) para un rango de fechas. Llama a esta herramienta siempre que necesites datos del negocio antes de analizar o proponer algo.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
      to: { type: "string", description: "Fecha fin YYYY-MM-DD" },
      granularity: { type: "string", enum: ["day", "week", "month"] },
    },
    required: ["from", "to"],
  },
  run: async (input) => JSON.stringify(await finzenApi.getKpis(input)),
});

// ...tools análogos: list_segments, evaluate_segment,
// create_campaign_draft, search_cerebro, save_content_draft

const runner = client.beta.messages.toolRunner({
  model: "claude-opus-4-8",
  max_tokens: 16000,
  thinking: { type: "adaptive" },
  system: SYSTEM_PROMPT, // ver §1.5
  tools: [getKpis, listSegments, evaluateSegment, createCampaignDraft, searchCerebro, saveContentDraft],
  messages: conversationHistory,
});

for await (const message of runner) {
  // persistir y streamear al chat del socio
}
```

### 1.2 Herramientas (tools) de la Fase 1

| Tool | Llama a | Notas |
|---|---|---|
| `get_kpis` | `GET /api/agent/kpis` | Devuelve el JSON tal cual; Claude lo interpreta |
| `list_segments` | `GET /api/agent/segments` | Catálogo con descripciones — Claude elige el slug |
| `evaluate_segment` | `GET /api/agent/segments/{slug}` | Solo counts + agregados |
| `create_campaign_draft` | `POST /api/agent/campaigns` | **Gate de confirmación** (ver §1.6) |
| `search_cerebro` | Drive API | Búsqueda en la carpeta Cerebro (ver §1.4) |
| `save_content_draft` | Drive API | Escribe un Google Doc en `Contenidos` |

Reglas para todos los tools:

- Validar inputs antes de ejecutar; devolver errores informativos con `is_error: true` para que Claude se recupere.
- Loggear cada llamada (tool, input, resultado resumido, timestamp, conversación) en la tabla de auditoría.
- Timeout de 30s por llamada HTTP; reintentos solo para lecturas (nunca para `create_campaign_draft`).

### 1.3 Chat con los socios

- **Backend:** `POST /chat/:conversationId/messages` recibe el mensaje del socio, corre el agente, y streamea la respuesta por SSE (Server-Sent Events). Persistir cada mensaje (rol, contenido, tool calls) en tu BD.
- **Frontend:** lista de conversaciones + vista de chat con streaming. Cuando el agente propone una campaña, renderizar una **tarjeta de propuesta** (título, mensaje, segmento, tamaño, racional) con estado (`propuesta`, `borrador creado en FinZen`).
- UI en **español**.
- Historial: al reanudar una conversación, reconstruir `messages` desde la BD (incluyendo bloques `tool_use`/`tool_result` para no romper el formato de la API).

### 1.4 Cerebro (Drive, lectura)

Enfoque pragmático — **no montes un vector store en Fase 1**:

1. Un job (al boot + cada 6h) lista los archivos de la carpeta Cerebro y descarga/exporta su texto (Google Docs → `export text/plain`; PDFs → texto).
2. Guarda un índice local: `{ fileId, nombre, resumen, texto }` en tu BD.
3. `search_cerebro(query)`: búsqueda por keyword/full-text sobre ese índice; devuelve los 3 fragmentos más relevantes con el nombre del archivo fuente.
4. Los documentos clave (marca, tono de voz) pueden inyectarse directamente en el system prompt si son cortos (< ~5K tokens).

Si el Cerebro crece (> ~50 documentos), evalúa embeddings; no antes.

### 1.5 System prompt (guía)

Elementos que debe contener (redáctalo y itéralo — es de lo más importante del proyecto):

- **Identidad y meta:** "Eres el agente de crecimiento de FinZen AI. Tu meta de fondo son los ingresos ($); tus palancas son activación (campañas internas) y adquisición (contenido/ads)."
- **Contexto del negocio:** qué es FinZen, los planes (FREE/Plus/PRO), qué es Zenio, qué mide cada KPI.
- **Reglas duras:** nunca inventes números — todo dato debe salir de un tool; nunca prometas envíos — solo creas borradores que un humano aprueba; no pidas ni manejes datos personales; responde siempre en español.
- **Estilo de propuestas:** cada propuesta de campaña incluye segmento + tamaño, mensaje sugerido, racional basado en datos, y qué se medirá (lift vs. holdout).
- **Contenido de marca:** tono de voz de FinZen (desde el Cerebro).

### 1.6 Guardarraíles de la Fase 1

1. **Doble aprobación en la creación de borradores:** el agente primero *propone* en el chat; el tool `create_campaign_draft` solo se ejecuta cuando el socio confirma explícitamente en la conversación ("créala"). Implementación: gate dentro del `run` del tool — si la propuesta no fue confirmada en esta conversación (flag en tu BD que setea un botón "Confirmar" en la tarjeta de propuesta), el tool devuelve "el socio aún no confirma; pregunta antes de crear el borrador".
2. **Límites de volumen:** máximo N borradores/día (configurable, default 5). Superado el límite, el tool rechaza.
3. **Audit log completo:** toda llamada a tools y toda propuesta quedan registradas e inmutables.
4. **Kill switch propio:** env var `AGENT_ENABLED=false` desactiva el loop (el chat responde "agente en mantenimiento"). El kill switch del lado FinZen es revocar la API Key.
5. **Manejo de errores del LLM:** verificar `stop_reason` en cada respuesta; ante `refusal` o error de API, mensaje claro al socio, nunca un crash.

### 1.7 Auto-medición

- Tool adicional opcional: `get_campaign_results(campaign_id)` — reutiliza `GET /api/agent/kpis` (bloque `campaigns`) para que el agente pueda responder "¿cómo le fue a la campaña de la semana pasada?" y aprenda qué mensajes funcionan.
- Job semanal (cron): el agente genera un **resumen semanal automático** (KPIs + campañas + 2-3 recomendaciones) y lo guarda como Doc en `Contenidos`.

### Criterios de aceptación Fase 1

- [ ] Un socio escribe "búscame la gente que tiene su presupuesto pasado" → el agente evalúa el segmento, responde con el count real y propone una campaña interna + conceptos de contenido.
- [ ] El socio confirma → el borrador aparece en el panel de FinZen vía `POST /api/agent/campaigns`.
- [ ] El agente nunca crea un borrador sin confirmación explícita (probado intentando engañarlo por chat).
- [ ] El agente responde preguntas de KPIs con números reales del endpoint (verificable contra el dashboard de FinZen).
- [ ] `search_cerebro` devuelve contenido real de la carpeta y el agente lo usa (p.ej. tono de marca en los mensajes).
- [ ] Audit log consultable de todas las acciones.
- [ ] Resumen semanal automático generado en Drive.

---

## FASE 2 — Agente externo con Meta (≈ 4 semanas) · **Riesgo medio, dinero real**

**Pre-condición:** Fase 1 estable en producción ≥ 2 semanas y aprobación explícita de FinZen para iniciar.

### 2.1 Secuencia de permisos (incremental)

1. **Solo lectura primero** (`ads_read`): tools `get_meta_campaigns`, `get_meta_spend` — leer campañas activas, spend, CPM/CPC/CTR, y cruzar con el CAC de la atribución de FinZen (ya viene en `/api/agent/kpis`).
2. **Escritura después** (`ads_management`), solo cuando la lectura lleve ≥ 1 semana estable.

### 2.2 Tools de Meta

| Tool | Graph API | Guardarraíl |
|---|---|---|
| `get_meta_campaigns` | `GET /act_{id}/campaigns?fields=...` | — |
| `get_meta_spend` | `GET /act_{id}/insights` | — |
| `create_meta_campaign_draft` | `POST /act_{id}/campaigns` + adsets + ads | **Siempre `status: "PAUSED"`**. Presupuesto ≤ `META_MAX_DAILY_BUDGET_USD`. Confirmación del socio (mismo gate que Fase 1). **Activarla (des-pausarla) es manual, un humano en Meta Ads Manager.** |

### 2.3 Contenido externo

- El agente genera conceptos de contenido (carruseles, guiones de reels) como Google Docs en `Contenidos`, con estructura estándar: hook, slides/escenas, CTA, segmento objetivo.
- El flujo de aprobación del contenido es humano (fuera del sistema): FinZen revisa el Doc y publica manualmente.

### 2.4 Cierre del loop externo

- El agente cruza spend de Meta con adquisición/CAC de la atribución de FinZen y lo reporta en el resumen semanal: "la campaña X trajo N usuarios a CAC $Y".

### Criterios de aceptación Fase 2

- [ ] El agente responde "¿cuánto gastamos en Meta este mes y a qué CAC?" con datos reales cruzados (Meta + FinZen).
- [ ] Puede crear una campaña completa en Meta **en pausa**, con presupuesto ≤ tope, tras confirmación del socio.
- [ ] Es imposible (probado) que el agente active una campaña o exceda el tope de presupuesto.
- [ ] Conceptos de contenido generados como Docs con la estructura estándar.

---

## FASE 3 — Plataforma multi-tenant (visión, fuera de alcance del pasante)

Empaquetar el motor como plugin para que otras empresas usen su propio agente de crecimiento. No se diseña ahora; solo mantén estas decisiones para no cerrarle la puerta:

- No hardcodees "FinZen" en la lógica: nombre del negocio, URL de la API, folders de Drive y system prompt salen de configuración.
- La capa de tools contra la "empresa" es una interfaz (`BusinessDataProvider`) con la implementación FinZen como primera instancia.

---

## 6. Guardarraíles transversales (resumen)

| Riesgo | Guardarraíl |
|---|---|
| Envíos masivos autónomos | El agente solo crea **borradores**; FinZen aprueba y envía. Límite de N borradores/día. |
| Dinero real en Meta | Todo se crea `PAUSED`; tope de presupuesto por env var; activación manual humana; lectura antes que escritura. |
| SQL libre / PII | No existe: solo segmentos curados con counts/agregados vía API. El agente nunca ve datos personales. |
| Medición sucia | Todos los números salen de la Agent API estructurada; el system prompt prohíbe inventar cifras. |
| Agente fuera de control | Kill switch doble: `AGENT_ENABLED=false` (tu lado) y revocación de API Key (lado FinZen). Audit log inmutable. |
| Credenciales | Nunca en el repo; solo env vars en Railway. La Service Account solo ve 2 carpetas de Drive. |

---

## 7. Definición de "terminado" por entregable

Cada PR/entregable debe incluir:

1. Código + descripción de qué hace y cómo probarlo.
2. Variables de entorno nuevas documentadas en el README.
3. Manejo de errores (nada de `catch` vacíos; errores de tools con `is_error: true`).
4. Registro en el audit log si la acción toca FinZen, Drive o Meta.

## 8. Cadencia de trabajo

- **Demo semanal** con José Luis (15–30 min): mostrar el flujo funcionando, no slides.
- Dudas sobre los contratos de la Agent API (§4) → se resuelven con FinZen y se actualiza este documento; el contrato escrito manda.
- Cambios de alcance (nuevas tools, nuevos permisos) → siempre aprobados por FinZen antes de codear.

---

## Apéndice A — Ejemplo de flujo completo (Fase 1)

1. Socio: *"Búscame la gente que tiene su presupuesto pasado."*
2. Agente → `list_segments` → encuentra `budget_exceeded` → `evaluate_segment("budget_exceeded")` → `{ count: 1240, ... }`.
3. Agente → `search_cerebro("tono de voz mensajes push")` → recupera guía de marca.
4. Agente responde: count + propuesta de campaña interna (mensaje redactado con el tono de marca) + 3 conceptos de contenido externo, y pregunta si crea el borrador.
5. Socio pulsa **Confirmar** en la tarjeta → siguiente turno, el agente ejecuta `create_campaign_draft` → `201 draft_abc PENDING_APPROVAL`.
6. FinZen aprueba en su panel → el broadcast se envía con holdout → días después el socio pregunta por resultados → agente → `get_kpis` (bloque campaigns) → reporta el lift.

## Apéndice B — Checklist de arranque (día 1)

- [ ] Invitación aceptada como colaborador de `github.com/jalonso83/Kaizen-Agent` (el repo es de FinZen; trabajas en ramas + PR, `main` protegida).
- [ ] Clonado el repo, `npm install` en `server/`, `.env` configurado desde `.env.example`.
- [ ] `npm run check` corrido — FinZen API y Anthropic en verde (Drive queda SKIP hasta la Fase 1).
- [ ] Recibido de FinZen: `FINZEN_AGENT_KEY` y `ANTHROPIC_API_KEY`.
- [ ] Creada la Service Account de Google y enviado su email a FinZen para compartir carpetas.
- [ ] Leído el doc de arquitectura "Ecosistema de crecimiento", este PRD completo y los README del repo.
- [ ] Railway (u otro) con proyecto creado y conectado al repo.
