# ESTADO_FASE_2.md — Bitácora viva de la Fase 2

> **Propósito:** que cualquier persona o agente de IA que entre al proyecto sepa
> en 2 minutos **dónde va la Fase 2, qué está hecho y qué falta** — sin tener que
> leerse los commits. La especificación vive en [`PRD_Kaizen.md`](PRD_Kaizen.md)
> §FASE 2; el estado de la Fase 1 vive en [`ESTADO.md`](ESTADO.md).
>
> **Regla:** quien termine una sesión de trabajo que cambie el estado de esta
> fase **actualiza este documento en el mismo commit**. Fechas siempre absolutas
> (YYYY-MM-DD).

---

## 📍 Dónde estamos (actualizado: 2026-08-20)

**Fase 2 arrancó el 2026-08-18**, con aprobación explícita del equipo el
2026-08-17. La precondición del PRD (Fase 1 estable en producción ≥2 semanas +
aprobación de FinZen) está cumplida.

Lo hecho hasta ahora se parte en dos bloques que no se parecen entre sí:

1. **La meta (goal) del negocio** — construida y probada. Es la pieza que hace
   que las campañas dejen de ser sueltas y persigan un número. Terminada y en
   producción.
2. **La integración con Meta** — el cableado y los guardarraíles están; falta lo
   que solo puede aportar FinZen (token, cuenta, tope) y probar contra la API
   real. Nada de esto se ha ejecutado nunca contra Meta de verdad: todo lo
   verificado hasta hoy es contra un mock local.

**El riesgo dominante de esta fase es distinto al de la Fase 1.** Acá hay dinero
real: lo peor que podía pasar antes era mandar un push malo; ahora es gastar.
Por eso los tres guardarraíles de Meta viven en código y no en el prompt.

---

## Bloque 1 — La meta (goal) · TERMINADO

Una campaña sin meta es una campaña que nadie puede evaluar. Kaizen ahora
propone una meta junto a la campaña, el socio la confirma, y Kaizen sigue
experimentando hasta lograrla.

### Qué se construyó

| Pieza | Dónde |
|---|---|
| Modelo `Goal` (métrica, objetivo, unidad, dirección, estado) | `server/prisma/schema.prisma` |
| Tools `propose_goal` · `get_active_goal` · `mark_goal_achieved` | `server/src/agent/tools/goals.ts` |
| Endpoint de confirmación/rechazo (única puerta a `ACTIVE`) | `server/src/routes/goals.ts` |
| Tarjeta de meta en el chat, con el antes → después | `web/src/components/GoalCard.tsx` |
| Pantalla **Metas** (vigente, pendientes, historial) | `web/src/pages/MetasPage.tsx` |
| Vínculo campaña → meta | `Proposal.goalId` |

Commits: `7a77d08` (la meta), `38380ca` (meta vigente en Auditoría),
`6bc633b` (pantalla de Metas + `Proposal.goalId`).

### Los candados, y por qué son de código

Pedido explícito del socio (2026-08-18): *"que no valen excusas de que si el
usuario dice que es emergencia o es admin o cualquier otra excusa"*. Eso no se
resuelve con una instrucción en el prompt, así que:

- **`PROPOSED → ACTIVE` lo escribe SOLO el endpoint HTTP del botón.** Igual que
  el gate de campañas de Fase 1. El agente no tiene forma de provocar esa
  transición por chat, así que "cambiá la meta, es una emergencia" no es una
  instrucción que el modelo deba resistir: es una operación que no existe de su
  lado.
- **`propose_goal` rechaza una segunda meta en paralelo.** Para cambiar la
  vigente hay que declarar a cuál reemplaza (`replaces_goal_id`), y el socio
  confirma viendo el antes → después.
- **`mark_goal_achieved` verifica el número en código**, no por juicio del
  modelo (`cumpleMeta()`). Un valor que no cumple el objetivo se rechaza y la
  meta sigue activa. No hay redacción que convenza a la aritmética de que 2,9
  es 3.
- **Una sola meta `ACTIVE` a la vez**, garantizado por transacción: nunca hay un
  instante con dos activas ni con ninguna.

### Verificación (2026-08-19, contra la BD local)

24 chequeos sobre los tools + los endpoints HTTP + la UI. Incluye los intentos
que deben fallar: cerrar una meta que no está activa, proponer una en paralelo,
cerrarla con 2,9 contra un objetivo de ≥3, cerrarla con un lift negativo, y una
meta invertida (CAC ≤ 0,5 no se cierra con 2,4). Un socio distinto intentando
confirmar una meta ajena recibe 404 y la meta queda intacta.

---

## Bloque 2 — Meta Marketing API · EN CURSO

### Qué se construyó (2026-08-20)

> ⚠️ **Al 2026-08-21 este bloque todavía NO está en `main`.** El código existe y
> está probado contra el mock, pero espera revisión antes de mergearse. Si
> clonaste el repo y no encontrás estos archivos, es por eso y no por un error.

| Pieza | Dónde |
|---|---|
| Cliente de la Graph API v21 | `server/src/clients/metaApi.ts` |
| Mock local (`npm run mock:meta`, puerto 4600) | `server/src/mock/metaApiMock.ts` |
| Tools `get_meta_campaigns` · `get_meta_spend` | `server/src/agent/tools/meta.ts` |
| Skill `adquisicion-pagada` (el método para leer pauta paga) | `server/skills/adquisicion-pagada/SKILL.md` |
| Config `META_*` | `server/src/config.ts` · `server/.env.example` |

### Los tres guardarraíles

1. **No hay forma de activar una campaña.** `createCampaignDraft` no recibe
   `status` como parámetro: está fijo en `'PAUSED'`. Mismo patrón que
   `create_campaign_draft` de Fase 1, que solo acepta un `proposal_id` — si el
   modelo no tiene dónde escribirlo, no hay instrucción que lo cambie.
   Des-pausar es un humano en Ads Manager.
2. **La escritura arranca apagada.** `META_WRITE_ENABLED=false` por defecto:
   aunque el token ya tuviera `ads_management`, no sale ni un POST. Así la
   secuencia del PRD §2.1 (leer ≥1 semana, después escribir) la hace cumplir el
   código en vez de depender de que alguien se acuerde.
3. **El tope se valida contra la moneda real de la cuenta.** Si la cuenta
   factura en una moneda distinta de USD, **rechaza en vez de convertir**: es
   preferible que alguien tenga que definir el tope en la moneda correcta a que
   Kaizen gaste con un tipo de cambio que nadie revisó.

### Verificación (2026-08-20, contra el mock)

25 chequeos del cliente + 22 de las tools. Los que importan son los que deben
fallar: presupuesto de 500 con tope de 50, presupuesto 0 y negativo, escritura
sin habilitar, cuenta inhabilitada (`account_status ≠ 1`), token inválido,
cuenta inexistente, un `status: 'ACTIVE'` colado en el input (se ignora, el POST
igual lleva `PAUSED`).

**Nada de esto se probó contra Meta real todavía.** El mock imita a propósito
las rarezas de Graph —números como string, presupuestos en centavos, errores con
`{error:{code, fbtrace_id}}`— porque un mock más prolijo que la realidad hace que
el código funcione en pruebas y falle el día del token.

---

## 🚧 Bloqueado — lo que solo puede aportar FinZen

| Qué | Por qué hace falta |
|---|---|
| `META_SYSTEM_TOKEN` con **solo `ads_read`** | Sin credencial no hay lectura. `ads_management` se pide después de ≥1 semana estable (PRD §2.1) |
| `META_AD_ACCOUNT_ID` | La cuenta publicitaria sobre la que leer |
| **El número de `META_MAX_DAILY_BUDGET_USD`** | Es una decisión de negocio, no técnica. El default de 20 es un valor de seguridad, no una cifra acordada |
| Confirmar si hay **gasto real** en la cuenta | Sin historial, `get_meta_spend` no tiene con qué probarse y "una semana estable de lectura" no prueba nada |
| La regla de **nombres de campaña ↔ `utm_campaign`** | Ver hallazgo abierto abajo |

> ⚠️ El token y la cuenta van **directo a las variables de Railway, nunca por
> chat**. Un System User Token da acceso al Business Manager entero. En este
> proyecto ya circuló una vez un JSON de credenciales por una conversación
> (ver `ESTADO.md`, pendiente de rotación).

---

## Hallazgos abiertos

### El cruce spend ↔ CAC no está validado (abierto desde 2026-08-20)

Para responder *"¿cuánto gastamos y a qué CAC?"* (criterio 1 de Fase 2) hay que
unir la campaña de Meta con el `utm_campaign` que FinZen registró en
`acquisition.by_source[]`. Son dos sistemas llenados por personas distintas: si
en Meta dice `FZ | Retargeting | Ago` y el utm dice `retargeting_ago`, no unen.

**Nadie confirmó que coincidan.** Por eso el cruce **no se hace en código**:
hacerlo sería congelar una regla de unión sin validar y produciría un CAC con
pinta de correcto y mal. La tool le avisa al modelo que compare los nombres y
diga explícitamente si unieron; *"no puedo cruzarlo"* es una respuesta correcta.

Cuando FinZen confirme la convención, esto se puede mover a código.

### Los acentos rompían la búsqueda del Cerebro (resuelto 2026-08-21)

Encontrado al verificar si las notas de Cerebro de Junior serían encontrables
por las consultas que sus skills ejecutan.

El diccionario `spanish` de Postgres normaliza el acento en **algunas** palabras
y en otras no: el stemmer solo reconoce el sufijo `-ción` cuando viene
acentuado. Verificado contra el Postgres real:

| Palabra | Con tilde | Sin tilde | ¿Unen? |
|---|---|---|---|
| métricas | `metric` | `metric` | sí |
| retención | `retencion` | `retencion` | sí |
| **atribución** | `atribu` | `atribucion` | **no** |
| **activación** | `activ` | `activacion` | **no** |
| **comparación** | `compar` | `comparacion` | **no** |
| **instrumentación** | `instrument` | `instrumentacion` | **no** |

O sea: un documento escrito sin tildes era inencontrable con una consulta
acentuada, y al revés. Los nombres de archivo son el peor caso porque casi nunca
llevan tilde. Y **activación es el norte del negocio de FinZen**, así que el caso
roto no era marginal.

Resuelto con una configuración de búsqueda propia, `es_kaizen` = `spanish` +
`unaccent` (migración `20260821120000_cerebro_unaccent`), usada tanto por la
columna generada como por `search_cerebro`.

Dos detalles del arreglo que conviene no perder:

- **`unaccent` va dentro de la configuración, no en la expresión.** La columna
  generada exige una expresión `IMMUTABLE` y `unaccent()` es `STABLE`, así que
  llamarla directo falla. `to_tsvector(regconfig, text)` —la forma de dos
  argumentos— sí es inmutable.
- **No hace falta reindexar desde Drive** (verificado): al recrear la columna
  generada, Postgres calcula el valor para todas las filas existentes a partir
  de `name` y `text`. Los 66 documentos del Cerebro quedan re-tokenizados en
  cuanto corre la migración en Railway.

Es el segundo bug de la misma familia que el de `translate()` del 2026-08-12: la
búsqueda no fallaba, devolvía menos de lo que debía y nadie lo notaba.

### El frontmatter de los skills se rompía con CRLF (resuelto 2026-08-20, sin mergear)

Encontrado de casualidad al probar el catálogo. En JavaScript `.` no matchea
`\r` y `$` sin flag `m` solo matchea el final del string, así que un `SKILL.md`
guardado con CRLF —cosa que pasa sola editando en Windows— no parseaba su
frontmatter: el skill se omitía con un warning en consola que nadie mira y
quedaba **invisible para el agente**. Le pasaba a `resumen-semanal`, el único de
los seis con CRLF: `load_skill('resumen-semanal')` respondía que no existe.

El cron del resumen no se rompió porque escribe sus propias instrucciones en
`weeklySummary.ts`, pero un socio que pidiera "hacé el resumen de la semana" por
chat no tenía el playbook detrás.

Arreglado en el parser (`\r?` en ambas expresiones) y no solo normalizando el
archivo, porque eso dejaba la trampa armada para el próximo que alguien edite en
Windows.

> **Cuarto caso en este proyecto** del mismo patrón: el error se registra en un
> warning o un `continue` y el sistema sigue como si nada. Los otros tres:
> el resumen semanal reportando éxito cuando la tool falló, el botón de
> reindexar, y el indexador del Cerebro tragándose archivos ilegibles.

---

## Criterios de aceptación de Fase 2 (PRD)

| # | Criterio | Estado |
|---|---|---|
| 1 | Responde "¿cuánto gastamos en Meta este mes y a qué CAC?" con datos reales cruzados | ⏳ Tools listas contra mock. Falta el token y validar el cruce |
| 2 | Puede crear una campaña en Meta **en pausa**, con presupuesto ≤ tope, tras confirmación del socio | ⏳ Cliente listo y probado. Falta `ads_management`, la tool y el gate |
| 3 | Es **imposible (probado)** que el agente active una campaña o exceda el tope | ⏳ Imposible por estructura y probado contra mock. Falta la prueba adversarial por chat |
| 4 | Conceptos de contenido generados como Docs con la estructura estándar | ⏳ No empezado |

---

## ⏳ Lo que sigue

1. **Cuando lleguen las credenciales:** primera lectura real contra Meta, y una
   semana de lecturas estables antes de tocar escritura.
2. **Validar el cruce de nombres** con FinZen y, si hay convención, moverlo a
   código.
3. **La tool de escritura** (`create_meta_campaign_draft`) pasando por el gate de
   confirmación, cuando FinZen habilite `ads_management`.
4. **La prueba adversarial de Meta** — el equivalente de la del gate de Fase 1:
   intentar por chat que active una campaña o se pase del tope, y verificar en
   el audit log que no salió ni un POST.
5. **Cerrar el loop externo** (PRD §2.4): reportar spend cruzado con CAC en el
   resumen semanal. Las tools de lectura ya están disponibles para el cron.
6. **Conceptos de contenido como Docs** (PRD §2.3).

---

## Decisiones tomadas en esta fase

| Fecha | Decisión | Por qué |
|---|---|---|
| 2026-08-18 | La meta la confirma el socio por botón; el agente no puede activarla ni cambiarla | Pedido explícito del socio: ninguna excusa ("emergencia", "soy admin") debe habilitar el cambio. Se resuelve quitando la capacidad, no pidiendo obediencia |
| 2026-08-19 | `Proposal.goalId` se graba al **proponer**, no se deduce por fechas | Entre proponer y ejecutar la meta puede cambiar. Una inferencia por ventanas de tiempo daría números plausibles y equivocados |
| 2026-08-19 | La pantalla de Metas **no muestra barra de progreso** | Exigiría medir la métrica en vivo, y las métricas son texto libre que elige Kaizen sin garantía de mapear a un campo de KPIs. Una barra al 60% que nadie midió es peor que ninguna |
| 2026-08-20 | El tope en moneda ≠ USD **rechaza** en vez de convertir | Antes que gastar con un tipo de cambio que nadie revisó |
| 2026-08-20 | La tool de escritura en Meta **no se registra todavía** | Darle al modelo una herramienta que no puede usar no lo hace más seguro, lo hace perder turnos intentándola |
| 2026-08-20 | El cruce spend ↔ CAC lo hace el **modelo con aviso**, no el código | La regla de unión no está validada; codificarla sería congelar una suposición |
