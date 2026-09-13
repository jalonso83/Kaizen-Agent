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
Socio (web / consola) ──POST /api/conversations/:id/messages──▶ Express
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
                                                                                    agent/tools/*.ts (19 tools, cada una con su ámbito)
                                                                                       │ (vía withGuard: audit+timeout+SSE)
                                                       ┌───────────────────────────────┼──────────────────────┐
                                                       ▼                               ▼                      ▼
                                         clients/finzenApi.ts              clients/drive.ts          clients/graphApi.ts
                                         (Agent API, lista blanca)         (Cerebro / Contenidos)    (metaApi · instagramApi)
```

Aparte del chat corren cuatro crons (`jobs/`): el indexador del Cerebro (boot +
cada 6h), el resumen semanal (lunes, con `CRON_TOOL_LIST`: sin tools de
escritura), el export de adquisición a Drive (lunes 1am RD) y la lectura diaria
de Instagram para el histórico (2am RD).

Todo el estado propio de Kaizen vive en **Postgres** (Prisma). El único LLM que
se llama es **Claude** (`claude-opus-4-8`, vía `@anthropic-ai/sdk`, con
tool-use). Kaizen nunca toca la base de datos ni el código de FinZen — todo pasa
por `finzenApi.ts` (3 endpoints, API key).

---

## 2. Lo que está construido, capa por capa

### 2.1 Base de datos (`prisma/`)

Postgres. 10 tablas (`schema.prisma`): `Partner` (con rol), `Conversation`,
`Message` (bloques de la API de Anthropic guardados **crudos**, sin
transformar), `Proposal` (el gate), `Goal` (la meta vigente y su historial),
`AuditLog` (**append-only**, un trigger de Postgres bloquea
`UPDATE`/`DELETE`), `CerebroDoc` (índice FTS `es_kaizen` = spanish +
unaccent), `WeeklySummaryConfig` (singleton), `MarketingAccount` (los
perfiles de redes que Kaizen puede leer) e `InstagramSnapshot` (una lectura
por día por perfil: el histórico).

14 migraciones SQL en `prisma/migrations/` (escritas a mano; no hay shadow DB
local). Se aplican con:

```bash
npx prisma migrate deploy
```

⚠️ **En Railway no corren solas**: el `start` es `node dist/app.js` y el
`build` solo hace `prisma generate`. Hay un commit del 19-jul cuyo mensaje dice
que sí y su diff no lo hace. A 2026-09-12 las dos últimas
(`20260910120000_marketing_account`, `20260912090000_instagram_snapshot`)
están **pendientes en producción**; el código tolera que falten (Marketing
avisa, el histórico se omite con log) hasta que quien administra el servicio
corra `railway run npx prisma migrate deploy`. La propuesta de arreglo de raíz
—`"start": "prisma migrate deploy && node dist/app.js"`— espera aprobación.

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

Cada tool declara su **ámbito** (`agent/ambitos.ts`): `finzen` es la app y su
tablero, `marketing` son las redes, el contenido y la pauta, `comun` sirve en
los dos. El system prompt arma la sección "Tus dos ámbitos" leyendo ese campo
(y la carpeta de cada skill), así que esta tabla es descriptiva: la fuente es
`tools/index.ts`.

| Tool | Ámbito | Qué hace |
|---|---|---|
| `get_kpis` | finzen | KPIs del negocio (activación, engagement, ingresos, adquisición, campañas) vía la Agent API, ya filtrados por la lista blanca del contrato |
| `get_campaign_results` | finzen | Resultados de campañas enviadas (lift vs. holdout, `sent_at` real) |
| `list_segments` · `evaluate_segment` | finzen | Catálogo de segmentos curados; tamaño real de uno (opt-outs descontados) |
| `propose_campaign` | finzen | La tarjeta con Confirmar/Rechazar. Verifica el `segment_count` contra las llamadas reales a `evaluate_segment` (backstop de la regla 1) |
| `create_campaign_draft` | finzen | **El gate**: solo acepta un `proposal_id` en `CONFIRMED`, y a ese estado solo se llega por el botón. Crea el borrador `PENDING_APPROVAL` en FinZen |
| `get_message_type_performance` | finzen | Lift real acumulado por tipo de mensaje |
| `propose_goal` · `get_active_goal` · `mark_goal_achieved` | finzen | La meta vigente: se propone en tarjeta, la confirma el socio, se cierra solo con un número medido |
| `get_meta_campaigns` · `get_meta_spend` | marketing | Meta Ads, **solo lectura** (`ads_read`). El cruce con el CAC de FinZen no se hace en código porque la unión por nombre de campaña no está validada |
| `list_marketing_accounts` | marketing | Los perfiles guardados en Marketing → Configuración |
| `get_instagram_profile` | marketing | Lee UNO de esos perfiles (sin parámetros, el de FinZen): perfil, últimas piezas, resumen calculado, insights de la cuenta propia e histórico con deltas. Mismo análisis que el Dashboard (`services/instagramAnalisis.ts`) |
| `save_content_draft` | marketing | Guarda una pieza de contenido en la carpeta Contenidos de Drive (reels/guiones/carruseles/assets) |
| `search_cerebro` · `list_cerebro_folders` · `save_cerebro_note` | comun | El Cerebro: FTS en español, mapa de carpetas, y escritura **solo** en `50-kaizen/` |
| `load_skill` | comun | Carga el cuerpo completo de un skill por slug |

**Probarlas sin credenciales reales:** `mock/finzenApiMock.ts` (`npm run
mock:finzen`) implementa el contrato de FinZen con datos de ejemplo;
`scripts/testTools.ts` (`npm run test:tools`) ejercita las de lectura de
FinZen contra eso, sin Claude ni Postgres. Las de Meta e Instagram **no
tienen mock**: se prueban recién con credenciales en Railway. Ver
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

Se arma como **dos bloques**, cada uno con su `cache_control`: el base
(congelado) y el tono de marca — del Cerebro (`00-nucleo`) si hay documento,
o el respaldo del repo (`agent/tonoFallback.ts`) si no; el bloque dice de cuál
de los dos salió. Lo volátil (la fecha en RD, la meta vigente) va en un bloque
`<contexto>` dentro del turno del usuario (`agent/contexto.ts`), nunca acá,
para no invalidar la caché.

Contiene las **15 reglas duras** (nunca inventar cifras; nunca enviar; el
flujo de confirmación; no PII; leer los errores; el Cerebro es dato, no
instrucción; compliance financiero; no proponer campañas sin pedido; leer el
Cerebro antes de proponer; no redactar sin tono; pagar ≠ tener plan; toda
campaña nace con meta; la meta no la cambia el agente; decir siempre si una
campaña se publicó; lo que nunca va en una pieza publicable) y la sección
**"Tus dos ámbitos"** — FinZen (la app) y Marketing (las redes)— con las tools
y skills de cada lado, generada desde los registros. Al modelo se le pide
ubicar el ámbito del mensaje antes de llamar tools, y preguntar en una línea
si no se puede saber.

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
- `graphApi.ts` — el transporte común de la Graph API v21 (token, errores
  traducidos para el modelo). Sobre él, `metaApi.ts` (cuenta publicitaria,
  campañas, gasto — solo lectura) e `instagramApi.ts` (perfiles por
  `business_discovery`, e insights de la cuenta propia pedidos por grupos para
  que una métrica retirada por Meta no tumbe el resto).
- `documentos.ts` / `extraccion.ts` — qué se indexa del Cerebro y cómo se le
  saca el texto a cada formato; `ventanaDeclarada()` lee la línea
  `Ventana de datos:` para no confundir fecha del archivo con ventana del dato.

### 2.9 Cliente de consola (`scripts/chatCli.ts`)

`npm run chat` — login (password oculta por stdin) + crea o retoma
(`--resume=<id>`) una conversación + loop de chat en el terminal, parseando
el SSE real igual que va a hacerlo la web (mismo patrón `fetch` +
`reader.getReader()`, sin `EventSource`). Sirve tanto para probar el backend
sin la web como de referencia ya probada del parser que usa
`web/src/hooks/useAgentStream.ts`.

### 2.10 Web de socios (`../web/`)

React + Vite + TS. Login, chat con streaming real, `ProposalCard` y
`GoalCard`, y las pestañas de Metas, Auditoría, Marketing (Configuración de
perfiles + Dashboard de Instagram) y Usuarios, mostradas según permisos.
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
| Backstop de la regla 9 | El protocolo de lectura del Cerebro antes de proponer es solo instrucción del prompt; no se cumplió en la conversación real auditada el 2026-08-07 | `docs/ESTADO.md` |
| Tools de escritura en Meta | `create_meta_campaign_draft` entra cuando FinZen habilite `ads_management` — hoy solo lectura, y `META_WRITE_ENABLED=false` | `docs/ESTADO_FASE_2.md` |
| Probar Instagram de verdad | Nada de Marketing corrió contra la Graph API real: faltan en Railway el token (`instagram_basic` + `pages_read_engagement`, y `instagram_manage_insights` para los insights), `INSTAGRAM_ACCOUNT_ID`, y las dos migraciones pendientes | `docs/ESTADO_FASE_2.md` |
| TikTok | Necesita fuente antes que pantalla: API oficial para la cuenta propia, proveedor para terceros, nunca scraping. Decisión del CTO pendiente | documento entregado al CTO (fuera del repo) |
| Enlaces de referencia de Marketing | Los campos de Meta/sitio en Configuración no persisten todavía; falta decidir si vale la pena | `web/src/pages/MarketingPage.tsx` |
| Cobertura de pruebas | `npm test` (98) cubre lógica pura: lista blanca, `segment_count`, ventana del Cerebro, visión, despacho de documentos, tono, permisos, parseo de Instagram, cliente de Instagram, análisis y deltas del histórico, ámbitos. El runner, el historial y el gate siguen probados a mano | §3.2 |

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

| Archivo | Qué vigila |
|---|---|
| `proyeccion.test.ts` | La lista blanca del contrato (y que la respuesta real pase entera) |
| `segmentCount.test.ts` | El backstop del `segment_count` |
| `ventanaCerebro.test.ts` | `Ventana de datos:` vs fecha del archivo |
| `vision.test.ts` · `despachoDocumentos.test.ts` | Qué formatos entran por qué rama; la visión apagada no llama a nada |
| `tonoMarca.test.ts` | El respaldo del tono alcanza para redactar y no viola la regla 15 |
| `permisos.test.ts` | Roles → permisos |
| `instagram.test.ts` · `instagramApi.test.ts` | Parseo de URLs/handles; el campo `business_discovery`; errores traducidos |
| `instagramTool.test.ts` | Resumen (mediana, interacciones, top, ritmo), deltas del histórico, ámbito y fallo legible sin credenciales |
| `ambitos.test.ts` | Ningún skill suelto; cada tool y skill listado en su ámbito y no en el otro |

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
