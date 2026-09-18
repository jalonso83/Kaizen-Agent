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

## 📍 Dónde estamos (actualizado: 2026-09-12)

**Fase 2 arrancó el 2026-08-18**, con aprobación explícita del equipo el
2026-08-17. La precondición del PRD (Fase 1 estable en producción ≥2 semanas +
aprobación de FinZen) está cumplida.

Lo hecho hasta ahora se parte en cinco bloques que no se parecen entre sí:

1. **La meta (goal) del negocio** — construida y probada. Es la pieza que hace
   que las campañas dejen de ser sueltas y persigan un número. Terminada y en
   producción.
2. **La integración con Meta** — el cableado y los guardarraíles están; falta lo
   que solo puede aportar FinZen (token, cuenta, tope) y probar contra la API
   real. Nada de esto se ha ejecutado nunca contra Meta de verdad: todo lo
   verificado hasta hoy es contra un simulador local.
3. **La capa de lectura** — dos paquetes que entregó Junior el 2026-08-20: el
   del tablero interno (4 skills) y el de redes sociales (5 skills), adoptados
   con correcciones y renombres. Funcionan a medias hasta que sus notas estén en
   el Cerebro, y los sociales además no tienen fuente de datos todavía.
4. **El sistema de marca y contenidos** — 8 documentos que subió marketing el
   2026-08-18. Adoptados por un humano en los skills; Kaizen todavía NO los lee,
   por decisión del socio, hasta resolver un conflicto de cifras.
5. **Marketing e Instagram** (2026-09-10 al 12) — el apartado de Marketing con
   sus perfiles, los dos ámbitos del agente, las tools de Instagram, el
   Dashboard y su histórico diario. Construido y probado en local con datos de
   ejemplo; **nunca contra Instagram real** — faltan las credenciales en
   Railway y dos migraciones. Es lo que sigue más abajo, después del Bloque 3.

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

| Pieza | Dónde |
|---|---|
| Cliente de la Graph API v21 | `server/src/clients/metaApi.ts` |
| Simulador local de la Graph API | *no está en el repo — decisión del socio, 2026-08-21* |
| Tools `get_meta_campaigns` · `get_meta_spend` | `server/src/agent/tools/meta.ts` |
| Skill `adquisicion-pagada` (mecánica de la integración) | `server/skills/marketing/adquisicion-pagada/SKILL.md` |
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

### Verificación (2026-08-20, contra el simulador local)

25 chequeos del cliente + 22 de las tools. Los que importan son los que deben
fallar: presupuesto de 500 con tope de 50, presupuesto 0 y negativo, escritura
sin habilitar, cuenta inhabilitada (`account_status ≠ 1`), token inválido,
cuenta inexistente, un `status: 'ACTIVE'` colado en el input (se ignora, el POST
igual lleva `PAUSED`).

**Nada de esto se probó contra Meta real todavía.** El simulador imita a propósito
las rarezas de Graph —números como string, presupuestos en centavos, errores con
`{error:{code, fbtrace_id}}`— porque un simulador más prolijo que la realidad hace que
el código funcione en pruebas y falle el día del token.

---

## Bloque 3 — La capa de lectura (skills de Junior) · ADOPTADA

El 2026-08-20 Junior entregó su método de análisis de reportes convertido a
cuatro skills y tres notas de Cerebro. Copia intacta de lo recibido en
`docs/recibido/2026-08-20-junior-metodo-de-lectura/`.

**Qué llenaba:** los seis skills que había eran casi todos de *acción* (qué
campaña proponer, cómo redactarla, cómo reportar). Ninguno cubría la capa de
*lectura*: qué se puede afirmar a partir de un número. Los suyos documentan seis
trampas verificadas del tablero donde leer el dato tal cual es directamente
falso.

| Skill | Cubre |
|---|---|
| `lectura-kpis-finzen` | Las seis trampas del tablero, cohorte contra período, márgenes de error por tamaño de muestra |
| `lectura-adquisicion-finzen` | CAC en tres niveles, la ambigüedad de atribución, el test de la restricción vinculante |
| `lectura-retencion-cohortes` | Sobrevida D1→D7 como la métrica que gobierna, madurez de ventana, bandas |
| `verificar-comparabilidad` | El chequeo antes de decir "subió" o "bajó" |

### Qué se corrigió al adoptarlos

Junior escribió sin acceso al repo, así que tres cosas no podían estar bien:

- **`lectura-adquisicion-finzen` §0 llamaba a la tool equivocada.** Mandaba usar
  `get_campaign_results` para campañas pagadas, y esa tool devuelve los
  *broadcasts internos* con holdout y lift. Se apuntó a
  `acquisition.by_source[]` de `get_kpis`, con el aviso de que es lifetime.
- **`lectura-retencion-cohortes` no es ejecutable entero.** `get_kpis` devuelve
  `retention_d1/d7/d30_pct` como agregados del período, **sin dimensión de
  cohorte**. La sobrevida D1→D7, la madurez de ventana y la separación
  orgánico/pagado no salen con las tools de hoy. Se marcó qué sí y qué no se
  puede, con la prohibición de estimar la sobrevida dividiendo D7 entre D1
  (son poblaciones distintas y ese cociente no es una sobrevida).
- **`adquisicion-pagada` (nuestro) se solapaba con el suyo.** Se redujo a la
  mecánica de la integración con Meta y delega todo el método de lectura al de
  Junior. Decisión del socio (2026-08-21): ante un solape, manda el material de
  Junior.

### El conflicto del holdout

`diseno-experimentos` §4 afirmaba que un `lift_pts` con holdout de ≥30 usuarios
era "señal real". La tabla de márgenes de `lectura-kpis-finzen` §3 dice que con
n=40 el margen al 95% es de ±12 puntos — y la propia tabla de dimensionamiento
del §2 produce holdouts de 30 a 60. La regla habilitaba justo el caso donde el
margen es de dos dígitos.

**Manda Junior.** Se quitó la afirmación y §4 ahora obliga a mirar el margen del
brazo más chico antes de leer el signo. Se agregó una distinción que faltaba: un
lift negativo por debajo del margen no significa que el mensaje no funcionó,
significa que no se pudo medir.

**Consecuencia a verificar:** los lifts medidos en este proyecto son del orden
de un punto, muy por debajo de esos márgenes. Probablemente ninguna campaña
interna tiene todavía una medición que signifique algo — y una meta de "lift ≥ 3
pts" no sería medible con los tamaños de cohorte actuales.

### Lo que falta para que funcionen

Los cuatro abren con `search_cerebro`. **Las tres notas de Junior todavía no
están en el Cerebro** (verificado en Drive el 2026-08-21): mientras no estén, los
skills buscan, no encuentran y siguen de largo en silencio. Las sube él, que es
el dueño de la carpeta.

Además, de las cinco consultas que ejecutan, **`"experimentos activos FinZen"`
no tiene nota que la responda**: ninguna de las tres lista experimentos vivos.
`lectura-retencion-cohortes` §5 depende de eso para decidir si lee por brazo.

### Segunda entrega, del mismo día (adoptada 2026-08-21)

Junior mandó **dos paquetes fechados 2026-08-20**, y ninguno menciona al otro:

| | Entrega A | Entrega B |
|---|---|---|
| Recibido en | `docs/recibido/2026-08-20-junior-metodo-de-lectura/` | `docs/recibido/2026-08-20-junior-metodo-y-conocimiento/` |
| Responde a | *"tu pedido del 20 de agosto"* | *"Pasar tus agentes de análisis a Kaizen"* |
| Dominio | el **tablero interno** de FinZen | el **sistema social** (IG/TikTok) |
| Corte | por dominio | por oficio |
| Contenido | 4 skills + 3 notas | 5 skills + 4 notas |

**No compiten** (confirmado por el socio, 2026-08-21): A lee el tablero, B lee
redes. Solo había dos choques reales, los dos resueltos:

1. `lectura-kpis` (B) chocaba de nombre con `lectura-kpis-finzen` (A).
2. La nota de rupturas está en las dos, con **las mismas 7 rupturas de
   producto**; la de B agrega la capa social y las líneas base de redes.

**B está mejor construida en un punto que importa:** aplica la separación
instrucción/información con más rigor. Sus skills son método puro y toda cifra
vive en las notas del Cerebro. A mezcla. Y esa diferencia arregla sola el
problema de `lectura-retencion-cohortes`: B pone el mismo contenido en una nota
(información que se cita) en vez de un skill (instrucción que no se puede
ejecutar).

**B también llena el hueco que A dejaba abierto:** su nota
`decisiones-cerradas-no-relitigar` lista H9, H10, H11 y H13 con su estado, que
es lo que `search_cerebro("experimentos activos")` no encontraba.

#### Cómo se instalaron

Renombrados para que el dominio sea explícito, porque lo que el modelo lee para
elegir es la **descripción**, no el nombre del archivo:

| De Junior | Instalado como |
|---|---|
| `lectura-kpis` | `lectura-kpis-social` |
| `sanidad-datos` | `sanidad-datos-social` |
| `umbrales-semaforo` | `umbrales-semaforo-social` |
| `top-flop-hipotesis` | `top-flop-contenido` |
| `lectura-experimentos` | *sin cambio* — lee evals de producto (H9, H13), no redes, y no choca con nada |

Las cinco descripciones se reescribieron para declarar su fuente de datos y
remitir a la contraparte (`lectura-kpis-social` → `lectura-kpis-finzen`,
`sanidad-datos-social` → `verificar-comparabilidad`, `top-flop-contenido` →
`diseno-experimentos`), con los punteros inversos puestos.

#### 🔴 Los cuatro skills sociales no tienen fuente de datos

**Ninguna tool de Kaizen trae números de Instagram o TikTok.** Salen de Windsor
y del panel nativo; el propio mapa de Junior lo declara. Los cuatro llevan un
bloque arriba diciéndolo, con la instrucción de decir que no hay acceso en vez
de estimar. Es el mismo tratamiento que `lectura-retencion-cohortes`.

Si en algún momento se le suma un feed social a Kaizen, los cuatro aplican tal
cual — eso es lo que Junior dejó preparado.

Los **umbrales sociales están PROPUESTOS y sin firmar** por el propio Junior
(cita del 17-ago). Marcado en `umbrales-semaforo-social`.

#### Hallazgos nuevos de B que cambian cosas

- **H11 (broadcast a base dormida) está CERRADO NEGATIVO.** No estaba en ningún
  lado. Importa porque el diagnóstico de marketing sugiere una campaña a los
  2.527 dormidos: Kaizen estaría reproponiendo algo ya cerrado.
- **FinZen es pre-PMF y "el modelo no monetiza" NO es afirmable**, porque solo
  el 2,6% de los FREE llegó a ver el paywall. Guardarraíl contra una conclusión
  fácil.
- **Cifras vetadas**: el "89,93% usa Zenio" era inflado (real 6-9%), el "86-89%
  de D1" era un bug de cálculo, y el "CAC $0,43" del panel es costo por registro,
  no CAC.
- **H10 corre al 100% sin brazo de control**, así que cualquier "lift" de su
  panel es artefacto y no se cita.

### Pendiente con Junior

1. La tabla de márgenes es para **una** tasa; el lift es una **diferencia** entre
   dos. Falta la versión para diferencias, o una regla de bolsillo.
2. ¿Dimensionar el holdout por **lift mínimo detectable** en vez de por
   porcentaje del segmento?
3. `verificar-comparabilidad` dice "Úsalo SIEMPRE", pero un skill se carga porque
   el modelo decide cargarlo. Si de verdad aplica siempre, su lugar es el system
   prompt.
4. En su nota de umbrales, **el MRR no reconcilia con la mezcla de planes**:
   $43.29 con 1 Plus ($4.99) y 4 Pro ($9.99) da $44.95. El ARPU sí cuadra con el
   MRR, así que los dos números concuerdan entre sí pero no con los planes.
5. **Al Cerebro debe subir UNA sola nota de rupturas**, la de la entrega B: las
   7 rupturas de producto están en las dos, y la de B agrega la capa social. Si
   suben ambas, `search_cerebro("rupturas de serie")` devolverá dos archivos
   parecidos y Kaizen citará el que gane en el ranking.

---

## Los dos ámbitos: FinZen y Marketing (2026-09-10)

Hasta este día Kaizen tenía 15 skills en una sola carpeta y 17 tools en una
sola lista, y el system prompt las presentaba todas juntas. Como el apartado de
Marketing ya existe en la web (cuentas de Instagram guardadas, el cliente de la
Graph API listo), el modelo iba a tener cada vez más pares que suenan igual y
no lo son: una "campaña" de push contra una "campaña" de Meta Ads; los "KPIs"
del tablero contra los "KPIs" de un perfil de Instagram; `get_kpis` contra lo
que traiga la tool social cuando exista. Elegir a ojo entre esos pares es
justo el tipo de cosa que un prompt largo hace mal.

**Qué se hizo:**

- `server/skills/` se partió en `finzen/` (8: campañas internas, tablero,
  retención, experimentos, resumen semanal) y `marketing/` (7: contenido,
  redes, pauta en Meta, adquisición). **La carpeta es la clasificación**; un
  `SKILL.md` suelto ya no entra al catálogo.
- Cada tool lleva `ambito: finzen | marketing | comun` (obligatorio en
  el tipo: no compila sin él).
- El system prompt reemplazó "Tus herramientas y tu mundo" por **"Tus dos
  ámbitos"**, y esa sección **se genera desde los dos registros** — tools por
  su campo, skills por su carpeta. La definición de cada ámbito (qué es y qué
  señales del mensaje lo delatan) vive en un solo archivo,
  `server/src/agent/ambitos.ts`.
- Instrucción al modelo: antes de llamar a cualquier tool, ubicar de qué
  ámbito habla el socio *en ese mensaje*; ante uno cruzado, usar cada lado para
  su parte y decir de dónde sale cada dato; ante uno indecidible, preguntar en
  una línea ("¿de la app o de las redes?").

**Qué NO se hizo, a propósito:** no se restringen las tools según una
clasificación automática del mensaje. Un clasificador que se equivoque
bloquearía una consulta legítima sin que nadie lo vea, y el criterio del
proyecto es que los candados de código sean solo para lo que no puede fallar
(gate de confirmación, Meta solo lectura) — ninguno de esos depende del ámbito.
El ámbito es una instrucción con estructura detrás, no un candado.

**Verificación:** `npm test` → 90/90. `ambitos.test.ts` cubre que no queden
skills sueltos, que cada uno esté en el catálogo con el ámbito de su carpeta,
que las tools de escritura hacia FinZen sigan en `finzen` y las de Meta en
`marketing`, y que el prompt liste cada tool y skill en su lado y no en el
otro. `docs/SKILLS.md` v1.2 tiene el catálogo partido.

### La tool de Instagram (2026-09-11)

Con la partición hecha, entró la primera tool nueva del lado de Marketing, y
apareció en el prompt sin tocar `systemPrompt.ts` — que era el punto.

- `list_marketing_accounts` — los perfiles guardados en Marketing →
  Configuración (usuario, URL, etiqueta, cuál es el de FinZen).
- `get_instagram_profile` — lee UNO de esos perfiles por business_discovery
  (`clients/instagramApi.ts`): seguidores, seguidos, publicaciones totales, y
  las últimas N piezas con likes y comentarios. Sin parámetros lee la cuenta
  de FinZen. El resumen (promedio, **mediana**, por tipo REELS/FEED, top 3,
  ventana real de fechas) se calcula en código, no se le pide al modelo.

**La regla que estructura las dos:** Kaizen **solo lee perfiles que un socio
guardó en Configuración**. No es un límite de la API —business_discovery lee
cualquier cuenta profesional pública— sino una decisión: qué mira Kaizen lo
decide un socio desde el apartado, no el modelo a pedido en un chat. Pedir
uno que no está devuelve un error que lista los guardados y dice dónde
agregarlo.

**Lo que viaja con el dato** (patrón de `kpis.ts`/`meta.ts`): likes y
comentarios son pulso, no funnel (skill `lectura-kpis-social`); los números
son del instante, sin histórico; y si el perfil es ajeno, que no se infiera
estrategia ni resultados de negocio de sus likes. Los cuatro skills sociales
cambiaron su bloque "no hay fuente" por uno que dice exactamente qué trae la
tool y qué no; `lectura-kpis-social` y `top-flop-contenido` la llaman en su §0.

**Errores que se traducen:** sin `META_SYSTEM_TOKEN`/`INSTAGRAM_ACCOUNT_ID`
→ "lo carga FinZen en Railway, no reintentes"; tabla `MarketingAccount`
inexistente (P2021, que es lo que va a pasar en producción hasta que se
aplique la migración) → "falta `prisma migrate deploy`", en vez del
"relation does not exist" crudo.

**Verificación:** 95/95 (`instagramTool.test.ts`: resumen con mediana y por
tipo, top 3, vacío sin NaN, ámbito y presencia en el cron por ser lectura,
fallo legible sin credenciales). **No se probó contra Instagram real**: hace
falta el token con `instagram_basic` + `pages_read_engagement` y el
`INSTAGRAM_ACCOUNT_ID` en Railway, y la migración aplicada.

### El Dashboard de Marketing, y los insights de la cuenta propia (2026-09-11)

El socio definió el Dashboard: **los datos que se leen de las redes**, y para
Instagram lo que importa a una cuenta de empresa — seguidores, likes,
comentarios, interacciones, etc. Se construyó junto con lo que faltaba del
lado de la API para que "importante" no fuera solo likes.

**Un solo análisis para el chat y la pantalla.** Lo que muestra el Dashboard
(`/api/marketing/instagram/:usuario`) y lo que devuelve `get_instagram_profile`
salen de la misma función, `services/instagramAnalisis.ts → analizarPerfil()`,
con la misma caché en memoria (10 min por usuario, por el límite de llamadas
de Meta). Si un número se ve raro, hay un solo lugar donde mirar, y arreglarlo
ahí lo arregla para los dos.

**Qué se considera importante, y de dónde sale:**

| Capa | Fuente | Qué |
|---|---|---|
| Perfil | `business_discovery` (cualquier cuenta profesional pública) | seguidores, seguidos, publicaciones totales, últimas N piezas con likes y comentarios |
| Calculado en código | las piezas | interacciones (likes + comentarios) totales y por pieza, **mediana** de likes, tasa de engagement (interacciones por pieza / seguidores), piezas por semana, mezcla REELS/FEED, top 3 por interacciones |
| Insights | `/{cuenta}/insights`, **solo la propia**, permiso `instagram_manage_insights` | alcance, views, cuentas que interactuaron, interacciones totales, likes, comentarios, guardados, compartidos, taps al link, altas/bajas, y seguidores nuevos por día (28 días) |

Los insights se piden **por grupos** y no en una llamada: Meta renombra y
retira métricas por versión (`impressions` → `views`, 2025), y una métrica
desconocida hace fallar la llamada entera. Con grupos, lo que no está llega
como `no_disponible` con su motivo —y el Dashboard lo muestra en un aviso—
en vez de esconder todo el bloque.

**La tasa de engagement tiene una definición dicha**: interacciones promedio
por pieza sobre seguadores × 100, la estándar para comparar cuentas. El campo
se llama `tasa_engagement_pct` y la tarjeta lo explica. Si algún día se
quiere la tasa sobre alcance, es otro campo con otro nombre.

**Verificación:** `tsc` limpio en server y web; 95/95 (el test del resumen
ahora cubre interacciones, top por interacciones y piezas por semana). El
Dashboard se revisó en el navegador con datos de ejemplo, en claro y oscuro.
**No se probó contra Instagram real** (mismas tres cosas pendientes en
Railway: token con `instagram_basic` + `pages_read_engagement` —y
`instagram_manage_insights` para los insights—, `INSTAGRAM_ACCOUNT_ID`, y
la migración aplicada). `server/public` reconstruido.

### Histórico: una lectura por día (2026-09-12)

La Graph API devuelve el instante. Para que el Dashboard (y Kaizen) puedan
decir "creció 120 seguidores esta semana" —de la cuenta propia o de un
competidor— hay que haber guardado cuántos había hace una semana.

**Qué se construyó:**

- Tabla `InstagramSnapshot`: una fila por (usuario, día civil RD) con
  seguidores, seguidos, publicaciones, interacciones promedio, mediana de
  likes, tasa de engagement, y los totales de insights (JSON) si los hubo.
  Migración `20260912090000_instagram_snapshot` — **pendiente en Railway**,
  junto con la anterior (documento de entrega actualizado).
- Se escribe desde dos lados: cada lectura real de `analizarPerfil` hace
  upsert de la fila de HOY (la última del día gana), y un **cron diario a las
  2am RD** (`jobs/instagramSnapshot.ts`) lee todas las cuentas guardadas,
  para que la serie exista aunque nadie abra la pestaña. Un fallo de una cuenta
  no frena a las demás; el resultado va al audit log como `cron:instagram-snapshot`.
- El análisis lleva ahora `historico`: la serie de 90 días y **`delta_7d` /
  `delta_30d` calculados en código** contra la lectura más reciente con al
  menos esa antigüedad. "Al menos" a propósito: si el cron falló un día, el
  punto de hace 8 sirve, y el campo `dias` dice la distancia real. Sin punto
  tan viejo, null — no se estima. La tool lo recibe con la nota de que un delta
  null significa "no hay dato", no "cero".
- Dashboard: variación a 7 días en las tarjetas de seguidores, publicaciones y
  tasa (verde/rojo), la de 30 días debajo, y una sección **Evolución** con la
  curva de seguidores (SVG a mano, sin librería) que dice desde cuándo hay
  datos.

**Robustez ante la migración pendiente:** guardar o leer el histórico con la
tabla ausente **no rompe la lectura** — se registra en el log y el análisis
sale con serie vacía. Así el Dashboard funciona hoy y gana la evolución el día
que apliquen la migración, sin deploy nuevo.

**Verificación:** 98/98 (`calcularDelta`: elige el punto correcto, null sin
dato, tasa null no rompe la resta). Pantalla revisada con 45 días de ejemplo.
Sin BD ni Meta reales, mismo pendiente de siempre.

### El criterio para leer la tool: `lectura-perfil-instagram` (2026-09-13)

La tool trae los números y las notas; le faltaba el método para
interpretarlos. Skill nuevo en `marketing/` (96 líneas): orden de lectura
(insights → tendencia → tasa y mediana → mezcla y ritmo → pulso), referencias
de tasa de engagement por tamaño de cuenta **dichas como referencia externa y
nunca como semáforo** (el skill de umbrales prohíbe copiar benchmarks sin
pasar por el histórico propio; cuando haya 4+ lecturas guardadas, la mediana
propia manda), mediana vs promedio (una viral en la muestra no es el nivel de
la cuenta), reel contra reel y nunca contra carrusel, tabla de cuándo un delta
es ruido (< 1 % de seguidores en 7 días), las tres relaciones de insights que
sí dicen algo (guardados/alcance, interacciones/alcance, taps al link contra
registros atribuidos de `get_kpis` — el único puente Instagram → negocio) y
qué se puede y no afirmar de un competidor. La tool remite al skill en su
descripción y en la nota que viaja con el dato. 16 skills en el catálogo.

### El resumen semanal ahora cubre los dos ámbitos (2026-09-13)

El cron de los lunes era solo de la app. Ahora el prompt del cron
(`jobs/weeklySummary.ts`) tiene un paso de Marketing: `list_marketing_accounts`
→ `get_instagram_profile` de FinZen (y hasta 3 competidores guardados) con el
skill `lectura-perfil-instagram`, y `get_meta_spend` de la semana si Meta está
configurado. El resumen gana la sección **"Redes y pauta"** (skill
`resumen-semanal` actualizado): seguidores con su `delta_7d` —que el cron
diario de snapshots deja listo justo para el lunes—, tasa y mediana con la
referencia de tamaño, insights si vienen, y los taps al link **al lado** de los
registros atribuidos a instagram de `get_kpis`, que es el puente entre las dos
mitades del resumen. Si la oportunidad de la semana es de contenido y no de
push, lo dice con 1-2 ideas en una línea.

Dos decisiones: (1) **se omite el dato, nunca la sección** — sin credenciales
o sin perfiles la sección lo dice en una línea y el resumen sigue, porque un
resumen sin la sección es indistinguible de uno donde Marketing no existe;
(2) `max_iterations` del cron pasa de 12 a 18: la sección suma hasta 6
llamadas más el skill, y con 12 el cron se quedaba sin vueltas antes de
`save_cerebro_note`, que es el único paso que el socio ve.

Las tools de Instagram y Meta ya estaban en `CRON_TOOL_LIST` (solo leen), así
que no cambió ningún candado. Sin credenciales, la corrida real va a producir
la línea "no configurado" en esa sección: es lo esperado hasta que Railway las
tenga.

### El simulador de la Graph API, esta vez en el repo (2026-09-14)

El de agosto se usó y se perdió. Este queda: `src/mock/graphApiMock.ts`
(`npm run mock:graph`) sirve Meta + Instagram con las rarezas que van a
aparecer el día del token real — métricas como string, presupuestos en
centavos, errores `{error:{code, fbtrace_id}}`, **un 200 sin
`business_discovery`** (que sin chequeo explícito daría un perfil con todo en
cero), piezas sin `comments_count` ni `media_product_type`, y una métrica
retirada que tumba el grupo entero de insights. Dos tokens: uno completo y
uno sin `instagram_manage_insights`; `MOCK_GRAPH_METRICAS_RETIRADAS` imita a
Meta retirando una métrica.

`scripts/testGraph.ts` (`npm run test:graph`) corre los clientes y
`analizarPerfil` contra él y **afirma 40 cosas** — no imprime y mira. Las que
importan: el campo anidado de business_discovery llega bien por la red; el
límite de piezas viaja y se topea en 50; los tres fallos de perfil salen
traducidos; sin permiso de insights **el perfil se lee igual** y los cuatro
grupos dicen por qué no; con `views` retirada caen solo esos totales; la
segunda lectura sale de caché; un tercero no lleva insights; y sin Postgres
el histórico se omite con aviso en vez de tumbar la lectura. El script fuerza
las variables al simulador, así no puede pegarle a la Graph real por
accidente. 40/40 en los dos modos.

Lo que esto NO prueba: que la Graph real se comporte como el simulador. Es
la mejor aproximación posible sin credenciales, y deja el primer día con
token real para descubrir diferencias, no bugs de parseo.

### Backstop de la regla 9 y enlaces de Marketing persistidos (2026-09-17)

Con las migraciones de Marketing aplicadas en producción (16-sep) y `main` al
día, dos cierres:

- **Backstop de la regla 9.** `propose_campaign` ahora exige, además del
  `segment_count` verificado, que en la misma conversación haya al menos una
  llamada a `search_cerebro` **con resultado** (`verificarLecturaCerebro`,
  mismo patrón sobre el audit log). Sin ella rechaza con la instrucción de
  buscar decisions-log y estado actual. Se exige lo mínimo verificable —que
  se leyó— y no qué se leyó: juzgar la calidad de la búsqueda rechazaría
  propuestas legítimas por un motivo que nadie podría explicarle al socio.
  Una búsqueda vacía no cuenta. Es el último hallazgo (B) de la auditoría del
  2026-08-07; los tres están cerrados.
- **Enlaces de referencia.** Tabla `MarketingLink` (clave → URL, una fila por
  enlace: agregar uno es agregarlo a la lista del frontend, sin migración),
  `GET/PUT /api/marketing/links`, y la sección de Configuración guarda de
  verdad: Guardar se habilita solo con cambios, Descartar vuelve a lo guardado,
  cada enlace guardado tiene "abrir". Es la última parte del apartado que decía
  "no conectado". Migración `20260917100000_marketing_link` — **pendiente en
  Railway**.

101/101.

### TikTok: la cuenta propia por la Display API (2026-09-18)

El socio pidió arrancar sin esperar la decisión sobre proveedores. Lo que se
puede construir sin ella es la **cuenta propia**, que es lo único que la API
oficial permite —y es la mitad que importa para el funnel—; los competidores
quedan explícitamente fuera hasta que haya proveedor.

- `clients/tiktokApi.ts`: Display API v2 (`/user/info/`, `/video/list/`
  paginado). **Tokens:** el access dura 24 h y se renueva solo; el refresh
  (365 días) **rota** — TikTok puede devolver uno nuevo y el anterior deja de
  valer— así que el vigente vive en `TiktokCredential` (BD) con copia en
  memoria, y `TIKTOK_REFRESH_TOKEN` solo siembra el primero. Si la BD no
  está, avisa y sigue en memoria: perder el token rotado por un fallo de BD
  dejaría a Kaizen sin TikTok hasta repetir el Login Kit.
- `services/tiktokAnalisis.ts`: mismo patrón que Instagram (un análisis para
  chat y Dashboard, caché de 10 min, snapshot diario en `TiktokSnapshot`,
  deltas reutilizando `armarHistorico`). Métricas de video corto: **mediana
  de views** (un viral multiplica el promedio), interacciones = likes +
  comentarios + compartidos, **engagement sobre views** como tasa natural de
  TikTok y sobre seguidores solo para comparar con Instagram, duración
  promedio, top 3 por views. Verifica que la cuenta autorizada sea la guardada.
- Tool `get_tiktok_profile` (marketing, solo lectura, en el cron);
  `list_marketing_accounts` ahora lista las dos redes y marca cuál es legible.
  Ruta `GET /api/marketing/tiktok/:usuario`; el cron diario también lee TikTok.
- Web: selector de red al agregar un perfil, chip de red en la lista y en el
  Dashboard, y `AnalisisTiktokVista`.
- `mock/tiktokApiMock.ts` + `scripts/testTiktok.ts`: 13 comprobaciones,
  incluida la rotación del refresh. Migración `20260918100000_tiktok`
  (`TiktokCredential`, `TiktokSnapshot`) — **pendiente en Railway**, junto
  con la de los enlaces.

**Lo que necesita FinZen:** una app en developers.tiktok.com con Login Kit,
autorizarla con la cuenta de FinZen, y cargar `TIKTOK_CLIENT_KEY`,
`TIKTOK_CLIENT_SECRET` y `TIKTOK_REFRESH_TOKEN` en Railway. Nada de esto
corrió contra TikTok real.

**Lo que sigue:** competidores de TikTok por proveedor (decisión del CTO), y
el skill de lectura de TikTok cuando haya datos reales que interpretar.

---

## Bloque 4 — El sistema de marca y contenidos · PARCIALMENTE ADOPTADO

El 2026-08-18 marketing (`inspirandord@gmail.com`) subió **8 archivos** a
`DRIVE_CONTENIDOS_KAIZEN`, en una carpeta nueva: `Documento maestro_Instrucciones_IA`.

No son archivos sueltos, es un sistema en cascada:

```
MTP → Manual de Marca → Estrategia de Comunicación → Sistema de Contenidos → Identidad Visual
                                    ↑
                    Diagnóstico de Activación (el porqué del reordenamiento)
```

Los dos PDF de `Métricas/` son el mismo contenido en dos formatos (documento y
presentación), no dos análisis distintos.

### Kaizen no puede leerlos, y por ahora es deliberado

Dos razones estructurales: el indexador solo recorre el **Cerebro**
(`listCerebroFilesRecursive`) y nunca toca Contenidos, y además **omite PDFs**
por diseño de la v1.

Decisión del socio (2026-08-21): **no indexarlos todavía**, hasta resolver el
conflicto de cifras de abajo. Indexarlos hoy empeoraría las respuestas.

### Qué se adoptó igual (leído por un humano, no por Kaizen)

- **`conceptos-contenido` reescrito.** Tenía cuatro pilares inventados con
  porcentajes; el sistema real tiene **seis con nombre**, cada uno mapeado a un
  arquetipo y a una etapa del embudo, más tres buyer personas (Génesis 21,
  Andrés 27, Massiel 25), la mezcla mensual de 8 piezas, las series fijas y la
  anatomía por formato. La regla que lo ordena todo: *una pieza, un pilar, una
  persona*.
- **Regla dura 15** en el system prompt: las cinco prohibiciones absolutas del
  Manual de Marca (no "democratizar", no encuadre socioeconómico, no
  banco/crypto/trading, no juzgar ni usar culpa, no cifras del negocio en pieza
  publicable sin aprobación).
- **`copy-push`**: registro dominicano, arquetipos, y la distinción entre cifra
  del usuario y cifra del negocio.

### La regla 15(e) NO contradice a la regla 1

Se aclaró explícitamente en el prompt porque se confunden: la regla 1 obliga a
citar cifras exactas cuando se **analiza** el negocio; la 15(e) prohíbe ponerlas
en una pieza que ve el público sin aprobación. **Analizar y publicar son cosas
distintas.** Los datos del propio usuario dentro de un push no son estadística
del negocio.

### Lo que validó por accidente

- **La paleta de la web de Kaizen es la correcta**: `#204274`, `#6CAD7F`, Rubik.
  Y el documento confirma que el verde sobre blanco reprueba accesibilidad
  (~1.9:1) y va solo en formas, nunca en texto — la misma decisión que ya estaba
  anotada en `styles.css`.
- **El registro es tuteo dominicano**, no voseo. Eso disparó una auditoría del
  repo entero (ver abajo).
- **El diagnóstico llega al mismo hallazgo que Junior** sobre D30 y churn en 0%:
  *"son casi con seguridad errores de medición"*. Dos fuentes independientes.

### El conflicto de cifras, reconciliado (2026-09-03)

| | Diagnóstico (25 jul) | Notas de Junior (17 ago) |
|---|---|---|
| Usuarios de pago | 7 | 5 |
| Costo por cliente que paga | **$79** | **$142.88** |
| Inversión | $552 (abr–jul) | $1,269.71 (lifetime) |
| D1 / D7 | 18.3% / 6.7% | 19-26% / 8-11% |

Son ventanas y denominadores distintos, así que probablemente los dos sean
correctos en su contexto. **Pero si Kaizen lee ambos sin saberlo, dará un CAC
distinto según cuál le pese más en la búsqueda**, y sin forma de que el socio
sepa cuál usó.

**La reconciliación está hecha** y vive en
[`docs/cerebro/finzen-cifras-ventanas-y-cac.md`](cerebro/finzen-cifras-ventanas-y-cac.md),
lista para subir a `10-decisiones/`. Ninguna de las cuatro filas resultó ser una
contradicción de medición:

- **CAC:** $552/7 = $78.86 es un **promedio acumulado** (stock de clientes vivos,
  abr–jul); $142.88 es el **costo marginal** de julio (suscripciones nuevas del
  mes). Para decidir si gastar un dólar más manda el marginal; el acumulado es
  narrativa histórica. Los tres niveles de Junior ($0.22 registro → $1.07
  activado → $142.88 suscripción) son **consistentes entre sí**: implican 20.6%
  de activación, dentro de su propia banda de 12-23%.
- **7 → 5 pagos:** es **churn entre ambas fechas**, visible en la serie de MRR
  del propio Junior — la caída de $53.28 a $43.29 son **$9.99 exactos, una
  suscripción Pro cancelada**. Se ve en el MRR y no en el indicador de churn,
  que Junior reporta con tres fallos consecutivos.
- **Retención:** 18.3%/6.7% caen apenas por debajo de las bandas porque el
  Diagnóstico promedia cohortes anteriores al 29-jun, que es cuando Junior
  documenta que D1 subió. Las dos fuentes coinciden por separado en que D30 y
  churn en 0% son errores de medición.

**Lo que sí queda abierto** (afinado, era el pendiente #4 de "Pendiente con
Junior"): el MRR de $43.29 contra 1 Plus + 4 Pro = $44.95, **$1.66 de
diferencia**. Ojo con la trampa: el **ARPU no es evidencia independiente**
($43.29/5 = $8.658, está derivado del MRR), así que la mezcla de planes es el
único número independiente — y es el que discrepa. No son dos contra uno.

⚠️ Las cifras del Diagnóstico salieron de esta misma tabla, **no del PDF
original**. La aritmética cierra, pero falta verificarlas contra la fuente.

### `search_cerebro` ahora distingue la fecha del archivo de la ventana de datos

El aviso que ya viajaba con los resultados desde el 2026-08-26 daba la **fecha
de Drive**, que es cuándo se editó el archivo y no de cuándo son sus datos: una
nota con cifras de julio editada en agosto se leía como "agosto", y el modelo la
comparaba contra otra de agosto como si midieran lo mismo.

Ahora cada resultado trae también `ventana`, leída de una línea
`Ventana de datos:` en el encabezado del documento (convención en
[`docs/cerebro/README.md`](cerebro/README.md); se aceptan `Ventana`, `Período` y
`Cubre`). Un documento sin la línea devuelve **"no declarada"** — que es
información honesta, no un default inventado — y se comporta igual que antes.
La convención se adopta documento por documento.

**Probado** (17 casos de lógica pura): el archivo real de la nota nueva, las tres
notas reales de Junior (ninguna declara ventana → "no declarada", no se inventa
nada), variantes con negritas/viñeta/cita/CRLF/mayúsculas, y los que NO deben
matchear: línea vacía, la palabra "ventana" suelta en prosa, y una declaración
más allá de los 800 caracteres del encabezado.

### Pendientes de este bloque

1. Verificar las cifras del Diagnóstico contra el PDF original y decidir si esos
   8 documentos se copian al Cerebro (hoy viven en `Contenidos/`, que el
   indexador **no recorre**, así que Kaizen no los lee y el conflicto está
   dormido). Con la nota de reconciliación arriba, copiarlos ya es seguro.
2. **Las personas y la mezcla mensual quedaron en el repo**, cuando por la regla
   del proyecto son *información* y deberían vivir en el Cerebro para que
   marketing las actualice sin un PR. Están en secciones separables (§2 y §5 de
   `conceptos-contenido`) para poder moverlas. Si marketing cambia una persona,
   hoy el skill queda viejo y nadie se entera.
3. El diagnóstico propone una solución de producto —una evaluación financiera de
   7 preguntas como puerta de entrada— y dice que *"el contenido lo pone
   Junior"*. Esa decisión no está en el `decisions-log.md`: no se sabe si se
   aprobó, se descartó o sigue esperando.
4. Hay un segmento sin usar: **2,527 usuarios registrados que nunca se
   activaron**. El diagnóstico dice que *"hoy nadie les está hablando"*. Falta
   ver si `list_segments` ya lo expone.

---

## Todo el proyecto pasó a tuteo (2026-08-21)

El Manual de Marca fija el registro: **español dominicano de la Gen Z, en "tú"**.
Buena parte de los textos escritos en agosto estaban en voseo rioplatense
("decí", "podés", "mirá"), que no es el registro de RD.

Auditado y corregido el repo entero: textos de la UI, mensajes de error del
servidor, descripciones de tools, reglas del system prompt y los diez skills.
**Cero ocurrencias de voseo** en `server/src`, `server/skills` y `web/src`.

No es cosmético: las descripciones de tools y el system prompt son lo que moldea
cómo escribe Kaizen. Si el prompt está en voseo, el copy de las campañas también
sale en voseo.

---

## Kaizen ya lee PDF, Word, Excel, PowerPoint y HTML (2026-08-25)

Hasta hoy el indexador solo leía **Google Docs y `.md`/`.txt`**. Todo lo demás se
contaba como "omitido" y quedaba invisible: los 8 documentos de marca (todos
PDF), los CSV semanales de adquisición, y cualquier reporte que alguien subiera
en otro formato.

| Formato | Cómo se lee |
|---|---|
| Google Docs · **Sheets** · **Slides** | Exportación de Drive, sin librería. Las hojas van a CSV y no a texto plano: exportarlas a plano pega las columnas |
| **PDF** | `unpdf` (pdf.js) |
| **Word** `.docx` | `mammoth` |
| **Excel** `.xlsx` | `exceljs` |
| **PowerPoint** `.pptx` | ZIP + los `<a:t>` de OpenXML (`jszip`) |
| **HTML** | Limpieza a texto propia |
| CSV, TSV, JSON, YAML, XML, MD, TXT, LOG, SQL… | Descarga directa |

### Tres decisiones

**No se instaló `xlsx` (SheetJS).** La versión publicada en npm está congelada
en 0.18.5 y arrastra una vulnerabilidad **alta** de prototype pollution
(GHSA-4r6h-8v6p-xvw6, afecta a `<0.19.3`). Kaizen parsea archivos de una carpeta
compartida, así que no es aceptable. Se usa `exceljs`, mantenido en npm.

**Un archivo sin texto NUNCA se indexa vacío.** Un PDF escaneado devuelve cadena
vacía sin lanzar error; guardarlo haría que la búsqueda lo devuelva, el modelo lo
cite y no diga nada. Ahora lanza `SinTextoError` con el motivo y el indexador lo
cuenta como **fallo visible**, distinto de "omitido": un `.png` omitido es
normal, un PDF que se quiso leer y no dio texto es algo que alguien debe ver.

*(Quinta aparición del mismo patrón en este proyecto.)*

**El HTML se limpia antes de indexar.** Encontrado al probar con archivos reales:
un reporte de 20 KB entraba con `<!DOCTYPE html>`, el CSS entero y las etiquetas,
llenando el índice de nombres de clases CSS. Ese archivo pasó de 19.745
caracteres de marcado a 14.068 de contenido.

### Verificación (2026-08-25)

22 chequeos con archivos sintéticos de cada formato, incluidos los que deben
fallar: PDF escaneado, Excel vacío, `.png` (omitido, no error), `.doc` binario
pre-2007 con instrucción de qué hacer, truncado a 200 KB con aviso. También que
Excel traiga el **resultado** de una fórmula y no la fórmula, que conserve el
nombre de cada hoja, y que PowerPoint ordene la diapositiva 2 antes que la 10.

Además contra documentos reales: 2 PDF y 2 `.docx` de reportes, más los 2 HTML
internos de FinZen. Todos extraen texto legible con tildes y ñ intactas.

**Lo que NO se pudo probar:** el indexador contra el Cerebro real. Las
credenciales de Drive del `.env` local apuntan a un proyecto con la API
deshabilitada y el índice local tiene 0 documentos. La prueba real es en Railway:
la corrida debe mostrar en Auditoría un desglose `por formato: google-doc=N
pdf=N texto=N …`.

> ⚠️ **Cuando esto llegue a Railway, los 8 PDF de marca entran al índice** (caben
> de sobra en los 200 KB por documento). En ese momento el conflicto de cifras
> entre el Diagnóstico de Activación y las notas de Junior deja de ser teórico:
> Kaizen podrá citar los dos y dar CAC distintos. Conviene resolverlo antes o a
> la vez.

---

## Botón Detener, y el heartbeat que nunca funcionó (2026-08-26)

No había forma de interrumpir a Kaizen a mitad de una respuesta.

**No era solo un botón.** El backend solo escuchaba el cierre de conexión para
apagar el heartbeat; la corrida seguía viva. Un botón puesto solo en la UI
habría dejado al agente gastando tokens, capaz de dejar una tarjeta de propuesta
que ya no se quería, y con la conversación bloqueada — el siguiente mensaje
habría dado 409.

**Cómo quedó:** el navegador aborta su `fetch`, eso cierra la conexión HTTP, y
eso dispara el `close` que corta la corrida de verdad. Un solo mecanismo, sin
endpoint nuevo. El SDK ya lo soporta: `toolRunner` acepta un `signal`.

**Se guarda el fragmento** (decisión del socio): lo que Kaizen alcanzó a
escribir se persiste marcado como `_(respuesta interrumpida)_`, con
`stopReason: 'aborted'`. Si cortaste porque ya viste lo que necesitabas, perder
media respuesta útil es molesto. Queda auditado como `run:aborted`, **no** como
error — interrumpir no es un fallo.

### 🔴 El bug que apareció de paso: `req.on('close')` no es lo que parece

Probando la interrupción, el mock que escribí para simular a Anthropic dejó de
emitir eventos por su cuenta. Medido con una sonda:

```
req 'close'  a los +2 ms      ← cuando termina de LEERSE el cuerpo
res 'close'  a los +1869 ms   ← cuando el cliente se desconecta de verdad
```

En Node moderno el `'close'` de la **petición** se emite al terminar de leer el
cuerpo, no cuando el cliente se va. Y `routes/chat.ts` y `routes/proposals.ts`
colgaban el heartbeat de ahí:

```js
const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
req.on('close', () => clearInterval(heartbeat));   // se limpia a los 2 ms
```

**El heartbeat se cancelaba antes del primer latido: nunca funcionó, desde Fase
1.** Su razón de ser es que Railway corta conexiones ociosas, así que una
corrida larga —con thinking y varias tools, fácil más de 15 s sin escribir
nada— podía estar perdiéndose ahí sin que nadie lo relacionara.

Y de rebote: el abort nuevo, colgado del mismo evento, habría abortado **todas**
las corridas a los 2 ms. Se descubrió solo porque la prueba falló.

Arreglado en los dos archivos cambiando a `res.on('close')`.

### El fragmento desaparecía: era una carrera (corregido 2026-08-26)

Probándolo con el modelo real, el texto a medias **se borraba entero** al
interrumpir. La causa: abortar el fetch cerraba la conexión, el cliente
limpiaba el texto en vivo y recargaba el historial **mientras el server todavía
estaba guardando el fragmento**. La recarga no encontraba nada.

En la prueba con el simulador ganaba el server por poco; con el modelo real, que
tarda más en cerrar, gana el cliente.

Se corrigió invirtiendo quién cuelga: **`POST /api/conversations/:id/stop`**. El
stream sigue abierto, el server corta la corrida, guarda, manda `done` y recién
ahí cierra. El cliente recarga sobre un historial que ya tiene el fragmento. El
`AbortController` del navegador queda solo como red de seguridad para cuando se
desmonta el componente.

`runningConversations` pasó de `Set<string>` a un `Map<string, AbortController>`
para que el endpoint pueda encontrar la corrida y cortarla desde otra petición.

### Dos cambios de interfaz que vinieron con esto

- **Detener reemplaza a Enviar** mientras Kaizen responde, en vez de vivir en la
  barra de estado: es donde el socio ya tiene la mano, y evita dos botones que
  hacen cosas opuestas conviviendo.
- **Editar un mensaje baja el texto al compositor**, no a un cuadro dentro de la
  burbuja. Se corrige donde se escribió, el botón pasa a decir *Guardar*, y
  Escape cancela.

### Verificación (2026-08-26)

12 chequeos contra un stream real, con un simulador local de la API de Anthropic
que responde despacio para poder cortarlo a mitad: el fragmento se guarda con su
marca y su `stopReason`, la respuesta completa NO se guarda, queda `run:aborted`
sin `isError`, no se registra ningún `run:error`, y el lock se suelta (el
siguiente mensaje da 200 y no 409).

Y en el navegador: el botón aparece junto a *"Kaizen está pensando…"*, al
pulsarlo el chat queda con el texto parcial más *"(respuesta interrumpida)"*, la
barra desaparece, el compositor se libera y no sale banner de error.

---

## 🔴 El historial se corrompía con dos rondas de tools (2026-08-27)

Reportado por el socio: al pedir campañas para usuarios dormidos, la auditoría
mostró

```
petición inválida — messages.16: `tool_use` ids were found without
`tool_result` blocks immediately after
```

**Son dos bugs distintos que llevan al mismo sitio.**

### 1. El orden de persistencia (pre-existente, y el más grave)

El runner guardaba los `assistant` DENTRO del bucle y los `tool_result` **todos
juntos al terminar**. Con dos rondas, la BD quedaba así:

```
A1, A2, U1, U2      ← lo que se guardaba
A1, U1, A2, U2      ← lo que de verdad pasó
```

La API exige que cada `tool_use` tenga su `tool_result` en el mensaje
**inmediatamente** siguiente, así que **cualquier turno donde Kaizen usara tools
en dos rondas dejaba la conversación rota para el turno siguiente**. No hacía
falta interrumpir nada. Explorar segmentos —`list_segments`, `evaluate_segment`,
`get_kpis`— es exactamente un flujo de varias rondas.

Corregido persistiendo los `tool_result` de cada ronda al empezar la siguiente,
con un índice sobre `runner.params.messages`.

### 2. La recuperación de huérfanos solo miraba el último mensaje

`buildHistory` revisaba `messages[length - 1]`. Eso bastaba mientras un corte a
mitad de turno dejara al `assistant` con `tool_use` al final — pero desde que
interrumpir guarda el fragmento de texto (2026-08-26), deja de ser cierto:

```
assistant → con tool_use, sin su tool_result
assistant → el fragmento guardado al interrumpir   ← el último ya no tiene tool_use
```

La recuperación no veía nada y el huérfano quedaba enterrado. **Ese lo introduje
yo**: el guardado del fragmento rompió la invariante en la que se apoyaba.

Ahora se recorre TODO el historial. La reparación es **en memoria y no se
persiste**: insertar en medio exigiría renumerar `seq` de todo lo posterior, y
la BD debe guardar lo que de verdad pasó. Es idempotente, así que rehacerla en
cada turno no cuesta nada.

### 3. El arreglo anterior cambió un error por el otro

Al redesplegar, el chat volvió a fallar — pero con el mensaje **espejo**:

```
petición inválida — messages.6.content.0: unexpected `tool_use_id` found in
`tool_result` blocks: toolu_01PHYZLtdz5FqQtzbjq2YTkM
```

La API impone **dos reglas simétricas**, no una:

1. Todo `tool_use` necesita su `tool_result` en el mensaje inmediatamente
   **siguiente**.
2. Todo `tool_result` necesita su `tool_use` en el mensaje inmediatamente
   **anterior**.

Mi reparación recorría el historial insertando lo que faltaba, de a pares. Con
el orden viejo `A1, A2, U1, U2` emparejaba `A2` con `U1` y arrastraba el
resultado de `A1` detrás de `A2`, donde su `tool_use` ya no estaba. Cumplía la
regla 1 rompiendo la 2. **También fue mío.**

La lección: el emparejamiento hay que **reconstruirlo**, no remendarlo. La
versión definitiva junta todos los `tool_result` del historial en un índice por
id, sin importar dónde estaban, y los recoloca detrás del `assistant` que los
pidió — con el resultado **real** si existe (los KPIs que Kaizen ya trajo no se
tiran a la basura) o uno sintético si no. Los `tool_result` sueltos que no
corresponden a ningún `tool_use` se descartan.

### Verificación

Ocho casos de lógica pura, cada uno validado contra **las dos** reglas — el
error anterior pasó justamente porque la prueba solo comprobaba una:

| Caso | Sin reparar | Reparado |
|---|---|---|
| Una ronda (lo normal) | válido | válido |
| Dos rondas, orden viejo | **roto (ambas reglas)** | válido |
| Interrupción con fragmento | **roto** | válido |
| Dos rondas, orden nuevo | válido | válido |
| Tools en paralelo, un solo resultado | **roto** | válido |
| `tool_result` huérfano (el error que introduje) | **roto** | válido |
| Texto y `tool_result` mezclados en un mensaje | válido | válido |
| Idempotencia (reparar dos veces) | **roto** | válido |

Además se comprueba en cada caso que no se pierdan los resultados reales de las
tools ni el texto del socio.

Contra la BD real (Docker arriba, 2026-08-27): se sembró una conversación con la
forma exacta del fallo de Railway y se pasó por `buildHistory` de verdad.
`A1, A2, U1, U2` sale reordenado a `A1, U1, A2, U2`, con `KPIS_REALES` y
`CEREBRO_REAL` intactos. Datos de prueba borrados al terminar.

**Lo que NO se pudo verificar:** el índice de `persistirPendientes` contra el
crecimiento real de `runner.params.messages` — hace falta la BD y un modelo que
llame tools. La reparación de huérfanos cubre el caso aunque ese índice estuviera
mal contado, así que el fallo no puede volver a escaparse por ahí.

**Las conversaciones ya rotas se arreglan solas** al desplegar: la reparación
actúa en la reconstrucción, no en lo guardado.

---

## Roles y permisos de usuario (2026-08-29)

Hasta ahora todo socio que entraba podía todo: el chat, confirmar campañas,
la auditoría, la configuración. Con el equipo creciendo eso deja de servir.

### Los tres roles

| Rol | En pantalla | Puede |
|---|---|---|
| `ADMIN` | CEO / CTO | todo |
| `ASSISTANT` | Asistente | chat + ver metas |
| `USER` | Usuario | solo el chat |

Los permisos son siete (`chat`, `metas:ver`, `metas:confirmar`,
`campanas:confirmar`, `auditoria:ver`, `config:editar`, `usuarios:gestionar`) y
viven en **`server/src/auth/permisos.ts`**, que es la única fuente de verdad.
Las rutas chequean **permisos, no roles**: mover un permiso de un rol a otro se
hace en un archivo, sin recorrer las rutas buscando `if (rol === 'ADMIN')`.

### Dónde está la garantía

En el servidor. `requirePermission` corre en cada router; el frontend solo
esconde pestañas, que es cortesía visual — cualquiera puede llamar la API a
mano. Si el frontend y la tabla de permisos se contradicen, manda la tabla.

Dos detalles que costaron pensarse:

- **Los dos routers de metas comparten `/api/goals`.** Un `router.use` en el de
  historial también se ejecutaría para las peticiones dirigidas al gate,
  negándolas con el permiso equivocado. Ahí el permiso va **por ruta**.
- **El rol NO viaja firmado en el JWT.** El token dura 7 días: si el rol fuera
  parte de la firma, quitarle permisos a alguien no tendría efecto hasta que
  caducara su sesión. Se lee de la BD en cada request, igual que `disabled`.

### El gate queda reforzado, no ampliado

Un `USER` puede pedirle a Kaizen que **proponga** una campaña — proponer solo
escribe en nuestra BD — pero confirmar exige `campanas:confirmar`. Ampliar
quién usa el chat no amplía quién publica en FinZen. La tarjeta se sigue viendo
entera y dice por qué no se puede confirmar, en vez de esconder los botones.

### Las reglas que evitan quedarse afuera

1. Nadie cambia su propio rol.
2. Nadie se deshabilita a sí mismo.
3. Nunca queda el sistema sin un `ADMIN` habilitado (chequeo dentro de la
   transacción, no antes).

La 3 **hoy es inalcanzable por HTTP**: solo un ADMIN puede degradar o apagar a
otro, y al serlo ya garantiza que quede uno. Se deja igual, como la red que
atrapa el día que alguien relaje las reglas 1 o 2. Está documentada en el código
como no cubierta por las pruebas, en vez de aparentar cobertura.

**No se borran socios, se deshabilitan.** Borrarlos se lleva sus conversaciones
por FK y deja el audit log con `partner:<id>` que ya no resuelven a ningún
nombre — justo el registro que sirve para saber quién autorizó qué campaña.

### La migración promueve a los socios que ya existían

`UPDATE "Partner" SET "role" = 'ADMIN'`. Dejarlos caer al default `USER` les
quitaría en silencio el acceso que ya tenían y, peor, dejaría la instalación
sin nadie que pueda repartir roles. Una migración no puede quitar acceso sin
que nadie se entere.

### Verificación

End-to-end contra el servidor Express real:

| Qué | Resultado |
|---|---|
| Matriz de 3 roles × 7 endpoints | los 19 chequeos correctos |
| Autoescalar rol / autodeshabilitarse | 400, ambos |
| Degradar a alguien con sesión abierta | pierde el acceso con la **misma cookie** |
| Repromoverlo | recupera el acceso, misma cookie |
| Rol corrupto en BD (`'BASURA'`) | no da **ningún** permiso, ni el chat |
| Cuenta deshabilitada con sesión viva | 401 en el request siguiente |
| `passwordHash` en respuestas | no aparece ni al crear ni al listar |

En el navegador: el Asistente ve solo Chat y Metas, sin engranaje de
configuración; el CEO/CTO ve las cuatro pestañas, con su propia fila marcada
"TÚ" y sus controles de rol y deshabilitar apagados.

### Pendiente de decidir con FinZen

- Un `ADMIN` **no** ve las conversaciones de los demás: siguen siendo privadas
  de cada socio, como antes. Si se quiere supervisión, es una decisión de
  privacidad que hay que tomar a propósito, no algo que deba colarse.
- Las contraseñas iniciales las pone un CEO/CTO (no hay envío de correos), así
  que las conoce hasta que la otra persona la cambie. Se agregó "cambiar mi
  contraseña" y la pantalla lo dice en voz alta, pero la solución de fondo es
  recuperación por correo.

---

## Auditoría de las carpetas de Drive (2026-09-03)

Se recorrieron el Cerebro y Contenidos archivo por archivo y se cruzaron con lo
que dice esta bitácora. **Cuatro hallazgos.**

### 🔴 No hay documento de tono en el Cerebro, y por eso nunca se inyectó

`agent/tono.ts` busca en **`00-nucleo`** un archivo cuyo nombre matchee
`/tono|voz|marca/i` e inyecta su contenido en el system prompt. Los cuatro
archivos que hay ahí son `producto.md`, `mtp-y-norte.md`, `estado-actual.md` y
`equipo.md`. **Ninguno matchea: `getTonoDeMarca()` devuelve `undefined` siempre.**

Esto corrige una suposición de la auditoría del 2026-08-07, que dio la regla
dura 10 por probablemente cumplida *"porque el tono viene inyectado
automáticamente si el indexador corrió"*. El indexador **sí** corre —los
resúmenes semanales y los CSV lo prueban—; lo que no existe es el documento. La
regla 10 prohíbe redactar copy sin la guía de tono cargada, así que o Kaizen se
niega a escribir copy, o lo escribe sin ella.

Los dos manuales de marca existen pero **los dos están en Contenidos**, que el
indexador no recorre: `assets/finzen-manual-de-marca.pdf` y
`Documento maestro/Manual de marca/FinZen_AI_Manual_de_Marca.pdf`. **Se arregla
copiando uno a `00-nucleo/` con "tono", "voz" o "marca" en el nombre** — un
archivo, y desde el 25-ago el indexador lee PDF.

### Las notas de Junior siguen sin subir (y ya están preparadas)

Verificado por dos caminos: `10-decisiones/` tiene un solo archivo
(`decisions-log.md`, sin tocar desde el 27-jul) y una búsqueda por título en
todo el Drive no encuentra ninguna. **Los 9 skills de lectura siguen buscando,
no encontrando y siguiendo de largo en silencio.**

Quedaron listas en [`docs/cerebro/de-junior/`](cerebro/de-junior/): las 6 que
suben (la séptima, la nota de rupturas de la entrega A, se descarta por
duplicada — decisión ya tomada acá), con la línea `Ventana de datos:` agregada y
**nada más tocado**. Sus cifras tienen corte al 17-ago y las de campañas son
lifetime, cosa que su `Actualizado: 2026-08-20` no decía.

### 🔴 El Cerebro está 60% lleno de material que no es de FinZen

Inventario real: **83 archivos, de los cuales 50 son podcasts** — 30
transcripciones (Raoul Pal, Moonshots, ILTB, Jordi Visser) sobre bitcoin, AI y
mercados, más 20 digests de esos mismos podcasts. Y son los archivos **más
grandes** del corpus: hasta 148 KB cada uno, contra los 6 KB del
`decisions-log.md`.

| Carpeta | Archivos |
|---|---|
| `30-ingesta/transcripts` | 30 (+2 basura, ver abajo) |
| `30-ingesta/digests` | 20 |
| `60-referencias` | 9 |
| `50-kaizen` | 6 (los resúmenes semanales) |
| raíz | 5 (README + 4 CSV de adquisición) |
| `00-nucleo` | 4 |
| `20-ideas` | 3 — `inbox.md` pesa 92 KB |
| `40-loops` | 2 |
| `10-decisiones` | **1** |

Agrava el problema de ranking del 12-ago más de lo que se pensaba: aunque
`ts_rank` ya normaliza por largo, una búsqueda de "activación" o "CAC" compite
contra 50 documentos enormes de vocabulario financiero solapado. La decisión de
negocio de FinZen vive en **un** archivo de 6 KB. No es un bug del código: es
curaduría, y vale plantear si los podcasts deberían vivir en una carpeta que el
indexador excluya.

### Lo que sí está funcionando, con evidencia

- **El cron del resumen semanal, sin fallar**: cinco resúmenes en `50-kaizen/` —
  10, 12, 17, 24 y **31 de agosto**.
- **El export de adquisición**: cuatro CSV en la raíz del Cerebro, mismas
  fechas. Diminutos (276-357 bytes), así que traen muy pocas filas.
- **`save_content_draft` no ha producido nada jamás**: `reels/`, `guiones/` y
  `carruseles/` solo tienen sus README y dos archivos que Junior subió el
  11-jul. Confirma con evidencia el criterio 4 de Fase 2.

### Correcciones a esta bitácora

- Los 8 archivos de marca **no son 8 PDF**: son **6 PDF y 2 PNG** (los
  storyboards de identidad visual). Hasta hoy los PNG eran ilegibles para
  Kaizen; ver la sección siguiente.
- Hay **dos archivos basura de 0 bytes** en `30-ingesta/transcripts` (`.wtest` y
  `.__wtest`, del 17-ago), restos de las pruebas de escritura en Drive. Conviene
  borrarlos: desde el 25-ago un archivo que se intenta leer y no da texto cuenta
  como **fallo visible**, así que ensucian el reporte de cada corrida.
- La carpeta de marketing se llama `" Documento maestro_Instrucciones_IA"`, con
  un espacio al inicio. Inofensivo hoy; muerde el día que se resuelva por nombre.

---

## Kaizen lee imágenes (2026-09-03)

Una imagen se contaba como "omitida" y quedaba invisible. Los dos storyboards de
marketing son PNG, así que **dos de sus ocho documentos no los podía leer
nadie** — y un diagrama, un pantallazo de un panel o una pieza de contenido
tienen texto y estructura perfectamente describibles.

Ahora las imágenes del Cerebro (`.png`, `.jpg`, `.webp`, `.gif`) se describen
con visión y **se indexa esa descripción**. El pedido a la que la genera es
concreto a propósito: qué tipo de pieza es, transcripción literal de todo el
texto visible, qué muestra —con los números exactos si es un gráfico o un
panel— y términos de búsqueda. Los números importan: son el motivo por el que
alguien va a buscar esa imagen.

### Cuatro decisiones

**No es OCR y el texto guardado lo dice.** Cada descripción empieza con una
línea que la marca como automática y aclara que no es el documento original.
Sin eso, dentro de tres meses alguien cita una descripción como si fuera una
transcripción exacta y nadie puede notar la diferencia.

**El costo es por versión, no por corrida.** El indexador ya solo re-lee lo que
cambió de `modifiedTime`, así que una imagen se describe **una vez** y no se
vuelve a pagar hasta que alguien la edite. Se apaga entero con
`CEREBRO_VISION_ENABLED=false`.

**Dos capas contra la inyección por imagen.** Una imagen puede tener texto
escrito dentro que parezca una orden. El prompt obliga a **transcribir** ese
texto como dato y no obedecerlo; la regla dura 6 cubre el otro extremo, donde el
agente lee lo que salió del Cerebro. Son dos capas para el mismo riesgo, a
propósito.

**El SVG se despacha por la rama de imagen aunque sea texto.** Si cayera por la
rama de texto plano se indexaría el XML del vector — el mismo ruido de marcado
que se limpió del HTML el 25-ago. Como la visión no acepta SVG, se omite; lo que
importa es que no entre como texto.

Un formato de imagen que la visión no acepta (`.bmp`, `.tiff`, `.heic`, `.svg`)
se **omite**, que es lo correcto; una imagen legible que no se pudo describir
—muy grande, error de la API, descripción vacía— es un **fallo visible**, igual
que un PDF escaneado. La distinción es la misma de siempre y por el mismo
motivo.

### Verificación

**Probado:** 15 casos del despacho — los cuatro formatos y su `media_type`, la
caída a la extensión cuando Drive no manda un mime útil, los formatos que se
omiten, el SVG que no debe entrar como texto, un PNG real de 1×1 que no se
indexa como binario, y que el markdown y el HTML siguen entrando por su rama de
siempre. Más `tsc --noEmit` limpio.

**NO probado:** la llamada real a la API de visión — hace falta una
`ANTHROPIC_API_KEY`, que este entorno no tiene. Las pruebas fuerzan
`CEREBRO_VISION_ENABLED=false` justamente para que no puedan llamarla. **La
primera corrida real hay que mirarla**: en Auditoría, el desglose por formato
del indexado debe mostrar `imagen=N`, y conviene abrir la descripción de uno de
los storyboards para ver si sirve antes de confiar en ella.

---

## Kaizen ya puede generar conceptos de contenido (2026-09-06)

Decisión del socio: **arrancar la generación de ideas de marketing sin esperar a
que los documentos de marca lleguen al Cerebro.** Faltaban dos piezas, y ninguna
era el documento.

### 1. El tono, con respaldo en el repo

La auditoría del 05-sep encontró que `getTonoDeMarca()` devolvía `undefined`
siempre porque en `00-nucleo` no hay documento de tono. Combinado con la regla
dura 10 —*no redactes copy sin la guía de tono cargada*— el resultado era una
pinza: o Kaizen se negaba a escribir, o escribía sin guía, que es peor porque
nadie se entera.

Ahora `tono.ts` cae a **`agent/tonoFallback.ts`**: lo esencial del Manual de
Marca oficial (v1.0, julio 2026) destilado a ~4.500 caracteres — registro
dominicano de la Gen Z en "tú", los dos arquetipos, personalidad, el
posicionamiento por contraste, Zenio con voz, y el vocabulario de producto.

**El Cerebro siempre gana.** El respaldo entra solo si la búsqueda en
`00-nucleo` no encontró nada, así que subir el manual a Drive no requiere tocar
código ni borrar el respaldo: la comparación la hace `tono.ts` en cada corrida.

**El prompt dice de dónde salió el tono** — "del Cerebro: `<archivo>`" o
"respaldo del repo" — porque el modelo debe saber si está leyendo la fuente
oficial o un destilado. Y el bloque del respaldo lo autoriza explícitamente a
redactar: sin esa frase, "respaldo" se lee como "incompleto" y el modelo se
niega igual, que es justo el comportamiento que se estaba quitando.

La **regla 10 se reescribió** en consecuencia: la guía viene siempre en el
prompt, las dos fuentes sirven para escribir, y solo si el bloque dijera que no
está disponible corresponde negarse.

Un fallo de BD tampoco deja al agente sin tono: `getTonoDeMarca()` atrapa el
error y devuelve el respaldo. Antes una caída de Postgres se manifestaba como
Kaizen negándose a redactar, que es un síntoma que no lleva a la causa.

### 2. El circuito a Contenidos, cerrado

El skill definía la estructura del Doc (§9) pero **nunca decía que había que
guardarlo**, ni en qué subcarpeta. Un concepto se redactaba en el chat y ahí
moría.

`conceptos-contenido` §10 nuevo: primero se discute en el chat y **solo se
guarda lo que el socio pida guardar** —un Doc en Drive parece decidido aunque no
lo esté—, después `save_content_draft` con el mapeo formato → subcarpeta
(reel/story/demo → `reels`, guion → `guiones`, carrusel → `carruseles`, apoyo →
`assets`), **un Doc por concepto** (tres conceptos son tres Docs, porque se
revisan y producen por separado), y sin reintentos si falla.

Y la prohibición explícita: **un concepto de contenido nunca va al Cerebro.** El
Cerebro es lo que Kaizen *lee* para trabajar; los conceptos son entregables que
un humano revisa. Meter una pieza publicable ahí la convierte después en
"conocimiento del negocio", y Kaizen terminaría citando un guion sin publicar
como si fuera un hecho. (`save_cerebro_note` ya lo decía en su descripción; ahora
también lo dice el skill, que es donde el modelo está mirando cuando redacta.)

### Verificación

11 pruebas nuevas (55 en total): que el respaldo trae registro, arquetipos y
audiencia; que **no contiene "democratizar"**, la palabra que él mismo veta; que
no supera los 6.000 caracteres, porque viaja en cada turno incluso cuando el
socio solo pregunta por KPIs; los tres estados del bloque de tono en el prompt;
y que la regla 10 ya no bloquea.

Una es una **prueba de deriva**: las subcarpetas que nombra el skill se cotejan
contra el enum `FOLDERS` real de la tool. Si alguien cambia el enum, el skill
queda mandando a una carpeta que la tool rechaza, y sin esta prueba eso aparece
recién en una conversación real con el concepto ya escrito.

**NO probado:** una conversación real de punta a punta — pedirle conceptos,
aprobarlos y ver el Doc aterrizar en `Contenidos/reels`. Necesita
`ANTHROPIC_API_KEY`. Es lo que cierra el **criterio 4 de Fase 2**, y es la
prueba que hay que correr en el server donde el socio prueba.

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

### El frontmatter de los skills se rompía con CRLF (resuelto 2026-08-20)

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
