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

## 📍 Dónde estamos (actualizado: 2026-08-21)

**Fase 2 arrancó el 2026-08-18**, con aprobación explícita del equipo el
2026-08-17. La precondición del PRD (Fase 1 estable en producción ≥2 semanas +
aprobación de FinZen) está cumplida.

Lo hecho hasta ahora se parte en cuatro bloques que no se parecen entre sí:

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
| Skill `adquisicion-pagada` (mecánica de la integración) | `server/skills/adquisicion-pagada/SKILL.md` |
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

### 🔴 Conflicto abierto: las cifras no coinciden

| | Diagnóstico (25 jul) | Notas de Junior (17 ago) |
|---|---|---|
| Usuarios de pago | 7 | 5 |
| Costo por cliente que paga | **$79** | **$142.88** |
| Inversión | $552 (abr–jul) | $1,269.71 (lifetime) |
| D1 / D7 | 18.3% / 6.7% | 19-26% / 8-11% |

Son ventanas y denominadores distintos, así que probablemente los dos sean
correctos en su contexto. **Pero si Kaizen lee ambos sin saberlo, dará un CAC
distinto según cuál le pese más en la búsqueda**, y sin forma de que el socio
sepa cuál usó. Hay que marcar la ventana de cada fuente antes de indexarlas.

### Pendientes de este bloque

1. Resolver el conflicto de cifras y recién entonces decidir dónde viven estos
   documentos y en qué formato (el indexador no lee PDF).
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
