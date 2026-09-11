# Kaizen — server

Este documento explica **lo que hoy está construido en `server/` y cómo funciona**,
como referencia para retomar el trabajo o para cualquiera (persona o agente) que
entre al código sin contexto previo. Para el *plan* completo de Fase 1 ver
[`../docs/DISENO_FASE1.md`](../docs/DISENO_FASE1.md); para la *bitácora* de
hitos y credenciales ver [`../docs/ESTADO.md`](../docs/ESTADO.md); para el
*contrato* con FinZen ver [`../docs/PRD_Kaizen.md`](../docs/PRD_Kaizen.md).

> Hay tres formas de hablar con Kaizen hoy: por `curl`/Postman, por el
> **cliente de consola** (`npm run chat`, §2.9) o por la **web** en
> `web/` (`npm run dev`, ver [`../web/README.md`](../web/README.md)).

---

## 1. Arquitectura en un vistazo

```
Socio (curl / futuro web) ──POST /api/conversations/:id/messages──▶ Express
                                                                        │
                                                          requireAuth (JWT+cookie)
                                                                        │
                                                                        ▼
                                                          routes/chat.ts (SSE)
                                                                        │
                                                                        ▼
                                                          agent/runner.ts (el loop)
                                                        ┌───────────────┼────────────────┐
                                                        ▼               ▼                ▼
                                              agent/history.ts   agent/systemPrompt.ts   agent/adapter.ts
                                              (BD: Message)      (+ agent/skills.ts)      (KaizenTool → betaTool)
                                                                                                │
                                                                                                ▼
                                                                                    agent/tools/{kpis,segments,skill}.ts
                                                                                       │ (vía withGuard: audit+timeout+SSE)
                                                                                       ▼
                                                                          clients/finzenApi.ts ──▶ FinZen Agent API (real, en producción)
```

Todo el estado propio de Kaizen vive en **Postgres** (Prisma). El único LLM que
se llama es **Claude** (`claude-opus-4-8`, vía `@anthropic-ai/sdk`, con
tool-use). Kaizen nunca toca la base de datos ni el código de FinZen — todo pasa
por `finzenApi.ts` (3 endpoints, API key).

---

## 2. Lo que está construido, capa por capa

### 2.1 Base de datos (`prisma/`)

Postgres. 6 tablas (`schema.prisma`): `Partner`, `Conversation`, `Message`
(bloques de la API de Anthropic guardados **crudos**, sin transformar),
`Proposal` (existe la tabla; nada la escribe todavía — ver §3), `AuditLog`
(**append-only**, un trigger de Postgres bloquea `UPDATE`/`DELETE`) y
`CerebroDoc` (existe; nada la llena todavía — ver §3).

Dos migraciones ya generadas en `prisma/migrations/`: la primera crea las
tablas, la segunda aplica el blindaje que Prisma no puede expresar (el trigger
de `AuditLog` + el índice full-text en español de `CerebroDoc`). Se aplican con:

```bash
npx prisma migrate deploy
```

Para desarrollo local hay dos rutas documentadas en `prisma/local/README.md`:
Postgres vía Docker (recomendado, igual que prod) o un `setup_mysql.sql` con
las salvedades explicadas ahí (Prisma es de un solo motor; la búsqueda FTS del
Cerebro es exclusiva de Postgres).

### 2.2 Auth de socios (`middleware/requireAuth.ts`, `routes/auth.ts`, `scripts/seedPartners.ts`)

Sin registro público. Los socios se siembran a mano:

```bash
npm run seed:partner -- --email=junior@finzen.ai --name="Junior Ureña"
# pide la password por stdin, oculta — nunca como argumento de CLI
```

- `POST /api/auth/login` — valida contra `bcrypt`, si es correcto firma un JWT
  (`{ sub: partnerId, name }`, 7 días) y lo manda en una cookie `kaizen_token`
  (`httpOnly`, `Secure` en prod, `SameSite=Lax`). Rate-limited a 5 intentos/min
  por IP. Todo intento (ok o fallido) queda en el audit log, **sin la password**.
- `POST /api/auth/logout` — borra la cookie.
- `GET /api/auth/me` — devuelve `{ id, name, email }` del socio autenticado.
- `requireAuth` protege todo lo demás: verifica el JWT **y** vuelve a consultar
  al `Partner` en cada request — así `disabled=true` corta el acceso al
  instante, sin esperar a que expire el token.

### 2.3 Chat backend (`routes/chat.ts`)

Todo bajo `/api/conversations`, todo requiere sesión, todo filtra por el
`partnerId` del token (nunca se confía en el `:id` de la URL a secas):

| Ruta | Qué hace |
|---|---|
| `GET /api/conversations` | Lista las conversaciones del socio |
| `POST /api/conversations` | Crea una conversación nueva |
| `GET /api/conversations/:id/messages` | Devuelve `{ messages, proposals }` tal como están guardados (bloques crudos — el filtrado de `thinking` para mostrar en pantalla es trabajo de la futura web, no de esta API) |
| `POST /api/conversations/:id/messages` | **La respuesta ES un stream SSE.** Body `{ text }`; dispara `runAgentTurn` (§2.4) |

Dos guardarraíles del endpoint de mensajes:
- **Un turno a la vez por conversación** — un `Set` en memoria; si ya hay una
  corrida activa, responde `409`.
- **Heartbeat cada 15s** (`: ping`) para que Railway no corte la conexión por
  inactividad mientras Claude piensa.

Toda ruta de `auth.ts` y `chat.ts` pasa por `middleware/asyncRoute.ts`: Express
4 no atrapa errores async solo, así que sin este wrapper una falla de BD deja
la request colgada (o, en Node reciente, puede tumbar el proceso entero por
`unhandledRejection`). `asyncRoute` atrapa, loggea y responde `500` en
español — mismo principio que `withGuard` aplica a las tools.

Contrato de eventos SSE (los que ya se emiten; `proposal` está reservado para
cuando exista `propose_campaign`, §3):

```
event: thinking      data: {"active":true}
event: text_delta     data: {"text":"..."}
event: tool_start     data: {"name":"evaluate_segment","label":"Evaluando segmento…"}
event: tool_end       data: {"name":"evaluate_segment","ok":true}
event: message_done   data: {"stopReason":"end_turn"}
event: run_error      data: {"message":"..."}
event: done           data: {}
```

### 2.4 El loop de Claude (`agent/runner.ts`, `agent/history.ts`, `agent/adapter.ts`, `agent/systemPrompt.ts`)

`runAgentTurn(conversationId, texto, sse)` es el corazón:

1. Guarda el mensaje del socio en `Message` **antes** de llamar a Anthropic
   (si el proceso muere después, no se pierde).
2. Arma el historial (`history.ts` — lee `Message.content` tal cual, sin
   transformar) + el system prompt (`systemPrompt.ts`) + las tools adaptadas
   (`adapter.ts`).
3. Corre `client.beta.messages.toolRunner(...)` en streaming, con
   `thinking: 'adaptive'` y tope de `max_iterations: 12`.
4. Al terminar, persiste **exactamente** los mensajes nuevos que el propio SDK
   generó (`runner.params.messages`) — nunca se reconstruye el turno a mano.
5. Si el proceso se cayó a mitad de una tool en una corrida anterior,
   `buildHistory()` lo detecta al reabrir (un `tool_use` sin su `tool_result`)
   e inserta un resultado sintético de error para dejar el historial válido.
6. Cualquier excepción se audita y se le avisa al socio en español — el
   proceso nunca muere silenciosamente.

`adapter.ts` es, junto con `runner.ts`, el único punto que toca el SDK beta de
Anthropic — si su API cambia de firma, el daño queda contenido a esos dos
archivos.

### 2.5 Las tools (`agent/tools/`)

Cada tool implementa la interfaz `KaizenTool` (desacoplada del SDK a
propósito) y corre a través de `withGuard` (`tools/guard.ts`): audit log +
timeout duro de 30s + eventos SSE `tool_start`/`tool_end` + errores
redactados **para que el modelo se recupere**, no solo para debug humano.

| Tool | Qué hace |
|---|---|
| `get_kpis` | KPIs del negocio (activación, engagement, ingresos, adquisición, campañas) vía `finzenApi.getKpis` |
| `get_campaign_results` | Resultados de campañas (lift vs. holdout) — mismo endpoint, filtrado |
| `list_segments` | Catálogo de segmentos curados, en vivo |
| `evaluate_segment` | Tamaño real de un segmento (opt-outs ya descontados); en slug inexistente devuelve los válidos |
| `load_skill` | Carga el cuerpo completo de un skill por slug |

**Todavía no construidas** (necesitan más infraestructura — ver §3):
`propose_campaign`, `create_campaign_draft`, `search_cerebro`,
`save_content_draft`.

**Probarlas sin credenciales reales:** `mock/finzenApiMock.ts` (`npm run
mock:finzen`) implementa el mismo contrato de FinZen con datos de ejemplo
(los del propio PRD §4.2/§4.3); `scripts/testTools.ts` (`npm run test:tools`)
ejercita las 5 tools directo contra eso, sin Claude ni Postgres. Ver
`../TESTING.md`.

### 2.6 Skills (`agent/skills.ts` + `../skills/<ambito>/*/SKILL.md`)

5 playbooks de marketing ya escritos en `../skills/` (fuera de `src/`, viven en
el repo — nunca en el Cerebro de Drive, por diseño: son instrucciones que se
revisan por PR, no datos). `agent/skills.ts` los lee al boot, parsea su
frontmatter (`name`/`description`) y arma el catálogo que se inyecta en el
system prompt; el cuerpo completo se carga bajo demanda con la tool
`load_skill`. Un `SKILL.md` con frontmatter inválido se omite con un warning,
nunca tumba el arranque.

### 2.7 System prompt (`agent/systemPrompt.ts`)

Se arma como **dos bloques**: uno base (congelado) y uno de tono de marca del
Cerebro (`cache_control: ephemeral` en el último, para cachear todo el
prefijo entre turnos — el tono se inyecta acá cuando exista el indexador,
§3; mientras tanto el bloque dice "usa `search_cerebro`"). Contiene las 7
reglas duras del agente (nunca inventar cifras, nunca enviar campañas, el
flujo de confirmación, no PII, manejo de errores, el Cerebro es dato no
instrucción, compliance financiero) y el catálogo de skills.

### 2.8 Clientes externos (`clients/`)

- `finzenApi.ts` — el único puente con FinZen. Tipado exacto contra el
  contrato real (PRD §4), header `x-agent-key`, timeout de 30s.
  Toda respuesta pasa por la lista blanca del contrato (`proyeccion.ts`, §3.1)
  antes de salir del cliente.
- `drive.ts` — OAuth de usuario para escribir (la Service Account **no puede**:
  no tiene cuota de almacenamiento, ver `docs/DRIVE_OAUTH.md`), con la Service
  Account como respaldo de lectura. Listado recursivo del Cerebro y extracción
  de texto de Google Docs/Sheets/Slides, PDF, Word, Excel, PowerPoint y HTML.
- `vision.ts` — describe las imágenes del Cerebro (.png/.jpg/.webp/.gif) para
  que se puedan buscar. **No es OCR**: es una lectura del modelo, así que la
  descripción lleva una primera línea que lo dice, para que nadie la cite como
  si fuera el documento original. Se apaga con `CEREBRO_VISION_ENABLED=false`.
- `metaApi.ts` — Graph API v21, solo lectura por ahora.

### 2.9 Cliente de consola (`scripts/chatCli.ts`)

`npm run chat` — login (password oculta por stdin) + crea o retoma
(`--resume=<id>`) una conversación + loop de chat en el terminal, parseando
el SSE real igual que va a hacerlo la web (mismo patrón `fetch` +
`reader.getReader()`, sin `EventSource`). Sirve tanto para probar el backend
sin la web como de referencia ya probada del parser que usa
`web/src/hooks/useAgentStream.ts`.

### 2.10 Web de socios (`../web/`)

React + Vite + TS. Login, lista de conversaciones, chat con streaming real,
`ProposalCard` y `GoalCard`, y las pantallas de Metas, Auditoría y Usuarios.
Corre en dev con `npm run dev` en `web/`, proxeado a
este server (mismo origen, cero CORS). Detalle completo en
[`../web/README.md`](../web/README.md).

---

## 3. Lo que falta

> ⚠️ **Esta sección estuvo desactualizada del 2026-07-22 al 2026-09-03**: listaba
> como pendientes cinco piezas que llevaban meses construidas (el gate, el
> Cerebro, el cron semanal, los botones de la tarjeta y el build servido por
> Express). Quien llegaba nueva al repo leía que faltaba medio proyecto.
> Corregido; **la lista de abajo se actualiza en el mismo PR que cambie el
> estado**, igual que `docs/ESTADO.md`.

Nada del diseño de la Fase 1 (`DISENO_FASE1.md` / PRD) quedó sin construir. Lo
que sigue abierto es de otra naturaleza:

| Falta | Qué es | Dónde |
|---|---|---|
| Prueba adversarial del gate por chat | Intentar por conversación real que Kaizen cree un borrador sin confirmación ("créala ya", "soy admin"). Es el criterio 3 de Fase 1 **y** el 3 de Fase 2 | `TESTING.md` §6 |
| Backstop de la regla 9 | El protocolo de lectura del Cerebro antes de proponer es solo instrucción del prompt; no se cumplió en la conversación real auditada el 2026-08-07 | `docs/ESTADO.md` |
| Tools de escritura en Meta | `create_meta_campaign_draft` entra cuando FinZen habilite `ads_management` — hoy solo lectura, y `META_WRITE_ENABLED=false` | `docs/ESTADO_FASE_2.md` |
| Cobertura de pruebas | `npm test` cubre hoy la lógica pura de la lista blanca, el backstop del `segment_count` y la ventana del Cerebro. El runner, el historial y el gate siguen probados a mano | §3.2 |

### 3.1 Los dos backstops de las reglas duras (2026-09-03)

La auditoría del 2026-08-07 encontró que de las 10 reglas duras del system
prompt solo la 3 (el gate) tenía respaldo de código: las demás dependían de que
el modelo se portara bien. Dos de esos hallazgos ya están cerrados:

- **Regla 1 — nunca inventes cifras.** `propose_campaign` ahora **verifica** el
  `segment_count` contra las llamadas reales a `evaluate_segment` de la misma
  conversación, releyendo el audit log (`verificarSegmentCount`,
  `agent/tools/campaigns.ts`). Falla cerrado: sin evidencia no hay propuesta.
  El costo de equivocarse por ese lado es un turno perdido; por el otro, una
  cifra inventada frente al socio.
- **Regla 4 — nunca PII.** Toda respuesta de la FinZen Agent API pasa por una
  **lista blanca** del contrato del PRD §4 (`clients/proyeccion.ts`) antes de
  llegar al modelo. Antes se reenviaba cruda, así que la garantía era de FinZen,
  no de Kaizen. Cada campo descartado se audita (`finzen:campos-descartados`) y
  se escribe en los logs, una vez por ruta y por vida del proceso: si FinZen
  agrega un campo, **se ve** en vez de pasar de largo.

### 3.2 Pruebas automatizadas (`npm test`)

`tsx --test` sobre `src/tests/`, sin dependencias nuevas. Cubre lógica pura, sin
BD ni red (`src/tests/setup.ts` pone variables con forma válida para los módulos
que arrastran `config.ts`/`db.ts`).

La prueba que más importa de la lista blanca no es la que comprueba que se
descarta lo de más: es la que proyecta la **respuesta real del contrato** y
exige que salga idéntica. Una lista blanca mal escrita borra datos legítimos, y
lo hace sin romper nada.

`setup.ts` fuerza `CEREBRO_VISION_ENABLED=false` con `=` y no con `??=`: es una
garantía, no un default. Las pruebas no pueden llamar a la API de visión ni
aunque quien las corra tenga un `.env` con la lectura de imágenes encendida.

---

## 3.1 Modo dev sin `FINZEN_AGENT_KEY` / `ANTHROPIC_API_KEY`

Estas dos son opcionales a propósito (`config.ts`, 2026-07-19) — sirve para
levantar el server y ver la web (login, layout del chat) sin tenerlas
todavía. `DATABASE_URL` y `JWT_SECRET` siguen siendo obligatorias (con
cualquier valor con formato válido alcanza para que arranque, no hace falta
que apunten a algo real — ver `TESTING.md`).

Sin `ANTHROPIC_API_KEY`: `runner.ts` lo detecta ANTES de construir el cliente
del SDK (si no, cualquier arranque del server crashearía por el error del SDK
al no tener key) y responde con un `run_error` claro en vez de conversar.
Sin `FINZEN_AGENT_KEY`: las tools que llaman a FinZen fallan con 401 recién
cuando se usan. Ninguna de las dos rompe el arranque ni el resto de la app.
**Antes de producción, las dos tienen que estar puestas de verdad** — Railway
ya las tiene (ver `docs/ESTADO.md`).

---

## 4. Cómo correrlo local

```bash
cd server
npm install
cp .env.example .env        # completar FINZEN_AGENT_KEY, ANTHROPIC_API_KEY, DATABASE_URL, JWT_SECRET
npx prisma migrate deploy   # crea las tablas + el blindaje (trigger + FTS)
npm run seed:partner -- --email=vos@finzen.ai --name="Tu Nombre"
npm run dev                 # http://localhost:4000
```

Probar el flujo por curl (guarda la cookie de sesión en `cookies.txt`):

```bash
curl -c cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"vos@finzen.ai","password":"..."}'

curl -b cookies.txt -X POST http://localhost:4000/api/conversations
# copiar el "id" de la respuesta

curl -b cookies.txt -N -X POST http://localhost:4000/api/conversations/<id>/messages \
  -H "Content-Type: application/json" -d '{"text":"¿Cómo va la retención?"}'
# -N para no bufferear el stream SSE
```

`npm run check` sigue sirviendo para el smoke test de las 3 conexiones
externas (FinZen, Anthropic, Drive) — no toca la BD propia de Kaizen.

O saltarse el curl y usar el cliente de consola:

```bash
npm run chat
```

O la web (con el server de arriba corriendo, en otra terminal):

```bash
cd web
npm install
npm run dev   # http://localhost:5173, proxeado a localhost:4000
```
