# SKILLS.md — Los skills de Kaizen

**Versión 1.2 · 2026-09-10** (v1.1: 2026-09-03 · v1.0: 2026-07-12)

Un **skill** es un playbook procedimental: instrucciones de *cómo hacer bien una
tarea específica* del oficio de growth/marketing, que Kaizen carga bajo demanda
en vez de inflar el system prompt. El system prompt define *quién es* Kaizen y
sus reglas duras; los skills definen *el método* para tareas concretas.

## Dónde viven y por qué

Los skills viven en **`server/skills/<ambito>/<slug>/SKILL.md`, dentro del repo** — NO en
el Cerebro (Drive). La razón es de seguridad, no de gusto: los skills son
**instrucciones** (cambian el comportamiento del agente), y el diseño de Fase 1
establece que *el texto del Cerebro es información, no instrucciones* (defensa
contra prompt-injection). Cambiar un skill = un PR revisado y versionado.
El Cerebro sigue siendo el lugar del *conocimiento* (tono, decisiones, datos);
los skills son el lugar del *método*.

## Los dos ámbitos (2026-09-10)

Kaizen atiende dos conversaciones distintas, y desde el 2026-09-10 la
estructura lo refleja en vez de dejárselo al criterio del modelo:

| Ámbito | Carpeta | De qué se habla | Tools propias |
|---|---|---|---|
| **finzen** — la app y su tablero | `server/skills/finzen/` | KPIs de la Agent API, segmentos, campañas internas por push, metas, retención, experimentos de producto | `get_kpis`, `get_campaign_results`, `list_segments`, `evaluate_segment`, `propose_campaign`, `create_campaign_draft`, `get_message_type_performance`, `propose_goal`, `get_active_goal`, `mark_goal_achieved` |
| **marketing** — redes, contenido y pauta | `server/skills/marketing/` | Instagram (TikTok después), ideas y piezas de contenido, resultados de piezas, Meta Ads, los perfiles guardados en el apartado de Marketing | `save_content_draft`, `get_meta_campaigns`, `get_meta_spend`, `list_marketing_accounts`, `get_instagram_profile` |
| *(comunes)* | — | Sirven en los dos | `load_skill`, `search_cerebro`, `save_cerebro_note`, `list_cerebro_folders` |

**La carpeta ES la clasificación del skill** (no hay campo en el frontmatter
que pueda decir otra cosa), y cada tool declara su `ambito` en código
(`KaizenTool.ambito`, obligatorio: una tool sin ámbito no compila). El system
prompt arma la sección "Tus dos ámbitos" **leyendo esos dos registros**
(`systemPrompt.ts → seccionAmbitos()`), así que agregar un skill o una tool
en su lugar la hace aparecer sola en el lado correcto; no hay una tercera
lista escrita a mano que pueda quedar vieja. La única definición de qué es
cada ámbito está en `server/src/agent/ambitos.ts`.

Al modelo se le pide que **antes de llamar a cualquier tool ubique de qué
ámbito habla el socio en ese mensaje** y use solo lo de ese lado; que ante un
mensaje que cruza los dos ("cuántos registros trajo el reel") use cada lado
para su parte diciendo de dónde sale cada dato; y que ante uno indecidible
("¿cómo vamos?") pregunte en una línea. Es una instrucción, no un candado: las
tools del otro ámbito siguen disponibles a propósito, porque restringirlas
por una clasificación automática del mensaje haría que un error de
clasificación bloqueara una consulta legítima. Los candados de verdad (gate de
confirmación, Meta solo lectura) no dependen del ámbito.

Un `SKILL.md` que quede suelto directamente en `server/skills/` (el layout
viejo) **se omite con warning** — y el test `ambitos.test.ts` falla, que es lo
que lo hace visible.

## Mecánica (construida — ver DISENO_FASE1.md §15)

1. Al boot, un loader lee los frontmatters de
   `server/skills/<ambito>/*/SKILL.md` y arma el **catálogo** (slug +
   descripción + ámbito).
2. El system prompt incluye solo el catálogo, partido por ámbito: una línea
   por skill diciendo cuándo usarlo, dentro de la sección de su ámbito.
3. La tool **`load_skill(slug)`** devuelve el cuerpo completo. Cada carga queda
   en el audit log, como toda tool.
4. El cron del resumen semanal precarga `resumen-semanal` directo en su prompt
   (no necesita la tool).

## Plantilla para skills nuevos

Copia esto a `server/skills/<ambito>/<slug>/SKILL.md` —eligiendo la carpeta
según de qué conversación es (ver "Los dos ámbitos")— y llena cada sección (borra las
que no apliquen — pero justifica; casi siempre aplican todas):

```markdown
---
name: slug-en-kebab-case
description: Úsalo cuando [situación concreta que lo dispara]. (Esta línea va al system prompt — es lo ÚNICO que el modelo ve antes de decidir cargarlo; escríbela como condición de disparo, no como resumen.)
---

# Título de la tarea

Una o dos líneas de contexto: por qué esta tarea importa para el crecimiento
de FinZen y cuál es el resultado esperado.

## 0. Antes de empezar (qué datos reunir)

Qué tools llamar SIEMPRE antes de ejecutar la tarea y en qué orden
(get_kpis, evaluate_segment, search_cerebro...). Un skill que no ancla al
agente en datos reales produce opiniones, no análisis.

## 1..N. El método

Los pasos, frameworks o tablas de decisión. Preferir:
- Tablas causa → acción (mejor que prosa)
- Fórmulas con ejemplos BUENOS y MALOS del contexto FinZen
- Umbrales concretos ("si el segmento < 100, entonces...")

## Anti-patrones / errores comunes

Qué NO hacer, explícito. El modelo evita mejor lo que está nombrado.

## Formato de entrega

Cómo se presenta el resultado al socio (o a Drive): estructura, cuántas
alternativas, qué incluye el racional.

---
*Adaptado de `<skill-origen>` — [repo](url) (LICENCIA).*  ← solo si aplica
```

**Checklist antes del PR** (además de las reglas de abajo):
- [ ] La `description` dice *cuándo* usarlo, no *qué es*.
- [ ] Toda instrucción de usar datos referencia una tool real de Kaizen.
- [ ] Tiene al menos un ejemplo bueno/malo o una tabla de decisión.
- [ ] < 150 líneas.
- [ ] Probado: pedirle a Kaizen una tarea del skill y verificar que lo carga
      (audit log) y sigue el método.
- [ ] Está en la carpeta de su ámbito (`finzen/` o `marketing/`), no suelto en
      `server/skills/`. `npm test` (`ambitos.test.ts`) lo verifica.
- [ ] Fila agregada al catálogo de este documento.
- [ ] `load_skill('<slug>')` responde de verdad. **Un `SKILL.md` guardado con
      CRLF no parseaba su frontmatter** y el skill quedaba invisible para el
      agente, con un warning en consola que nadie mira (bug real del
      2026-08-20; le pasaba a `resumen-semanal`). El parser ya lo tolera, pero
      la comprobación es de dos segundos y es la única que lo detecta.

## Reglas para escribir/editar skills

1. **Español siempre** — cuerpo y descripción.
2. **Un skill = una tarea.** Si cubre dos oficios, son dos skills.
3. **Nunca contradecir las reglas duras del system prompt.** Si hay conflicto,
   ganan las reglas duras (no inventar números, no enviar nada, gate de
   confirmación). Un skill no puede pedirle al agente que se las salte.
4. **Referirse a las tools reales de Kaizen** — no a capacidades que no tiene
   (no hay navegador, no hay filesystem, no envía emails).
5. **Aterrizado a FinZen** — segmentos reales (dormant, never_activated,
   budget_exceeded, trial_ending, active), push/slot como superficies, lift vs
   holdout como medición.
6. **Corto y denso.** El skill se carga al contexto y cuesta tokens: frameworks
   y checklists, no ensayos. Objetivo: < 150 líneas.
7. **Atribución**: si se adaptó de un repo open source, una línea al final
   (los de marketing vienen de repos MIT — ver abajo).
8. Al agregar/quitar un skill: actualizar el catálogo de este doc en el mismo PR.
9. **Un skill pertenece a un solo ámbito.** Si sirve en los dos, es que cubre
   dos oficios (regla 2): se parte.

## Catálogo actual (15 skills)

> Actualizado 2026-09-10 con la partición por ámbito. Se actualiza **en el
> mismo PR** que agregue, quite o mueva uno.

Dos ejes cruzados. El **ámbito** (la carpeta) dice de qué conversación es el
skill: la app o las redes. La **capa** dice qué tipo de instrucción es: los de
**acción** dicen qué hacer, los de **lectura** dicen qué se puede afirmar a
partir de un número — esa capa faltaba entera hasta que Junior la entregó el
2026-08-20 (ver `docs/ESTADO_FASE_2.md`, Bloque 3).

## Ámbito FinZen — `server/skills/finzen/` (8)

### Acción — qué proponer y cómo redactarlo

| Skill | Cuándo lo usa Kaizen | Origen |
|---|---|---|
| [`campanas-retencion`](../server/skills/finzen/campanas-retencion/SKILL.md) | Reactivar/retener usuarios (dormidos, nunca activados, presupuesto excedido, trial por vencer) | Adaptado de `churn-prevention` (coreyhaines31/marketingskills, MIT) |
| [`copy-push`](../server/skills/finzen/copy-push/SKILL.md) | Redactar título (≤100) y mensaje (≤200) de un push/slot — son los parámetros `title`/`message` de `propose_campaign` | Adaptado de `copywriting` + `sms` (mismo repo, MIT) |
| [`diseno-experimentos`](../server/skills/finzen/diseno-experimentos/SKILL.md) | Definir holdout e hipótesis **antes** de la campaña | Adaptado de `ab-testing` (mismo repo, MIT) |
| [`resumen-semanal`](../server/skills/finzen/resumen-semanal/SKILL.md) | Formato y criterios del reporte semanal (cron del lunes) | Propio de Kaizen |

### Lectura del tablero interno — qué se puede afirmar (Junior, entrega A)

| Skill | Cuándo lo usa Kaizen |
|---|---|
| [`lectura-kpis-finzen`](../server/skills/finzen/lectura-kpis-finzen/SKILL.md) | Antes de interpretar cualquier KPI agregado. Documenta seis trampas verificadas del tablero donde leer el dato tal cual es falso |
| [`lectura-retencion-cohortes`](../server/skills/finzen/lectura-retencion-cohortes/SKILL.md) | Retención D1/D7/D30. La métrica que gobierna es la **sobrevida** entre D1 y D7, no cada una por separado |
| [`verificar-comparabilidad`](../server/skills/finzen/verificar-comparabilidad/SKILL.md) | **Siempre** antes de decir que algo subió o bajó |
| [`lectura-experimentos`](../server/skills/finzen/lectura-experimentos/SKILL.md) | Al vencer la ventana de un experimento (H9, H13) o una campaña: veredicto con el pre-registro, y cierre del bucle escribiendo el aprendizaje al Cerebro |

## Ámbito Marketing — `server/skills/marketing/` (7)

### Acción y pauta

| Skill | Cuándo lo usa Kaizen | Origen |
|---|---|---|
| [`conceptos-contenido`](../server/skills/marketing/conceptos-contenido/SKILL.md) | Conceptos de contenido externo (reels, carruseles, guiones). Reescrito con el sistema real de marketing: 6 pilares, 3 buyer personas, mezcla mensual | Adaptado de `social` (MIT) + sistema de marca de FinZen |
| [`adquisicion-pagada`](../server/skills/marketing/adquisicion-pagada/SKILL.md) | Mecánica de la integración con Meta: qué significa cada campo y qué puede y no puede hacer Kaizen en esa cuenta | Propio de Kaizen (Fase 2) |
| [`lectura-adquisicion-finzen`](../server/skills/marketing/lectura-adquisicion-finzen/SKILL.md) | CAC/ROI y dónde poner presupuesto. La ambigüedad de atribución sin resolver invalida cualquier lectura ingenua de ROI | Junior, entrega A |

> `lectura-adquisicion-finzen` está acá y no en FinZen aunque lea la tabla de
> fuentes de la Agent API: su pregunta es *cuánto cuesta traer un usuario por
> Meta*, que es una decisión de pauta. Lo que mide es marketing; de dónde lo
> lee es un detalle.

### Lectura de redes sociales (Junior, entrega B)

> 🟡 **Instagram parcial, TikTok nada (2026-09-11).** `get_instagram_profile`
> lee los perfiles guardados en Marketing → Configuración y trae lo público:
> seguidores y, por pieza, likes y comentarios — **pulso, no funnel**. Alcance,
> guardados, retención de video, clicks y registros atribuidos siguen sin
> tool (necesitan `instagram_manage_insights` sobre la cuenta propia; segundo
> paso). Los cuatro skills llevan un bloque que lo declara, con la instrucción
> de decir que no hay acceso en vez de estimar.

| Skill | Cuándo lo usa Kaizen |
|---|---|
| [`lectura-kpis-social`](../server/skills/marketing/lectura-kpis-social/SKILL.md) | Los 5 KPIs del funnel social + el pulso |
| [`sanidad-datos-social`](../server/skills/marketing/sanidad-datos-social/SKILL.md) | Movimiento >20% o dos paneles que no coinciden: distingue tubería rota de realidad rota |
| [`umbrales-semaforo-social`](../server/skills/marketing/umbrales-semaforo-social/SKILL.md) | Semáforo verde/ámbar/rojo. **Los umbrales vigentes están PROPUESTOS y sin firmar** por Junior |
| [`top-flop-contenido`](../server/skills/marketing/top-flop-contenido/SKILL.md) | Leer resultados de piezas publicadas y decidir qué se repite, pausa o prueba |

⚠️ **Los skills de lectura abren con `search_cerebro`, y las notas de Cerebro de
Junior todavía no están subidas a Drive** (verificado 2026-08-21). Mientras no
estén, buscan, no encuentran y siguen de largo en silencio. Las sube él.

**Candidatos para Fase 2** (cuando llegue la escritura en Meta): adaptar
`ad-creative` del mismo repo MIT.

## Fuentes del ecosistema (por si se buscan más)

- [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) — ~45 skills de marketing, MIT
- [whyashthakker/agent-skills-marketing](https://github.com/whyashthakker/agent-skills-marketing) — 50+ skills, MIT
- [anthropics/skills](https://github.com/anthropics/skills) — repo oficial, Apache 2.0
