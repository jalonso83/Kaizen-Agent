# SKILLS.md — Los skills de Kaizen

**Versión 1.1 · 2026-09-03** (v1.0: 2026-07-12)

Un **skill** es un playbook procedimental: instrucciones de *cómo hacer bien una
tarea específica* del oficio de growth/marketing, que Kaizen carga bajo demanda
en vez de inflar el system prompt. El system prompt define *quién es* Kaizen y
sus reglas duras; los skills definen *el método* para tareas concretas.

## Dónde viven y por qué

Los skills viven en **`server/skills/<slug>/SKILL.md`, dentro del repo** — NO en
el Cerebro (Drive). La razón es de seguridad, no de gusto: los skills son
**instrucciones** (cambian el comportamiento del agente), y el diseño de Fase 1
establece que *el texto del Cerebro es información, no instrucciones* (defensa
contra prompt-injection). Cambiar un skill = un PR revisado y versionado.
El Cerebro sigue siendo el lugar del *conocimiento* (tono, decisiones, datos);
los skills son el lugar del *método*.

## Mecánica (construida — ver DISENO_FASE1.md §15)

1. Al boot, un loader lee los frontmatters de `server/skills/*/SKILL.md` y arma
   el **catálogo** (slug + descripción).
2. El system prompt incluye solo el catálogo: una línea por skill diciendo
   cuándo usarlo.
3. La tool **`load_skill(slug)`** devuelve el cuerpo completo. Cada carga queda
   en el audit log, como toda tool.
4. El cron del resumen semanal precarga `resumen-semanal` directo en su prompt
   (no necesita la tool).

## Plantilla para skills nuevos

Copia esto a `server/skills/<slug>/SKILL.md` y llena cada sección (borra las
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

## Catálogo actual (15 skills)

> Actualizado 2026-09-03. Este catálogo estuvo listando 5 skills mientras había
> 15 instalados, incumpliendo la regla 8 de abajo. Se actualiza **en el mismo
> PR** que agregue o quite uno.

Los skills se agrupan en tres capas. La distinción no es cosmética: los de
**acción** dicen qué hacer, los de **lectura** dicen qué se puede afirmar a
partir de un número, y esa capa faltaba entera hasta que Junior la entregó el
2026-08-20 (ver `docs/ESTADO_FASE_2.md`, Bloque 3).

### Acción — qué proponer y cómo redactarlo

| Skill | Cuándo lo usa Kaizen | Origen |
|---|---|---|
| [`campanas-retencion`](../server/skills/campanas-retencion/SKILL.md) | Reactivar/retener usuarios (dormidos, nunca activados, presupuesto excedido, trial por vencer) | Adaptado de `churn-prevention` (coreyhaines31/marketingskills, MIT) |
| [`copy-push`](../server/skills/copy-push/SKILL.md) | Redactar título (≤100) y mensaje (≤200) de un push/slot — son los parámetros `title`/`message` de `propose_campaign` | Adaptado de `copywriting` + `sms` (mismo repo, MIT) |
| [`diseno-experimentos`](../server/skills/diseno-experimentos/SKILL.md) | Definir holdout e hipótesis **antes** de la campaña | Adaptado de `ab-testing` (mismo repo, MIT) |
| [`conceptos-contenido`](../server/skills/conceptos-contenido/SKILL.md) | Conceptos de contenido externo (reels, carruseles, guiones). Reescrito con el sistema real de marketing: 6 pilares, 3 buyer personas, mezcla mensual | Adaptado de `social` (MIT) + sistema de marca de FinZen |
| [`resumen-semanal`](../server/skills/resumen-semanal/SKILL.md) | Formato y criterios del reporte semanal (cron del lunes) | Propio de Kaizen |
| [`adquisicion-pagada`](../server/skills/adquisicion-pagada/SKILL.md) | Mecánica de la integración con Meta: qué significa cada campo y qué puede y no puede hacer Kaizen en esa cuenta | Propio de Kaizen (Fase 2) |

### Lectura del tablero interno — qué se puede afirmar (Junior, entrega A)

| Skill | Cuándo lo usa Kaizen |
|---|---|
| [`lectura-kpis-finzen`](../server/skills/lectura-kpis-finzen/SKILL.md) | Antes de interpretar cualquier KPI agregado. Documenta seis trampas verificadas del tablero donde leer el dato tal cual es falso |
| [`lectura-adquisicion-finzen`](../server/skills/lectura-adquisicion-finzen/SKILL.md) | CAC/ROI y dónde poner presupuesto. La ambigüedad de atribución sin resolver invalida cualquier lectura ingenua de ROI |
| [`lectura-retencion-cohortes`](../server/skills/lectura-retencion-cohortes/SKILL.md) | Retención D1/D7/D30. La métrica que gobierna es la **sobrevida** entre D1 y D7, no cada una por separado |
| [`verificar-comparabilidad`](../server/skills/verificar-comparabilidad/SKILL.md) | **Siempre** antes de decir que algo subió o bajó |
| [`lectura-experimentos`](../server/skills/lectura-experimentos/SKILL.md) | Al vencer la ventana de un experimento (H9, H13) o una campaña: veredicto con el pre-registro, y cierre del bucle escribiendo el aprendizaje al Cerebro |

### Lectura de redes sociales (Junior, entrega B)

> 🔴 **Ninguna tool de Kaizen trae números de Instagram o TikTok** — salen de
> Windsor y del panel nativo. Los cuatro llevan un bloque que lo declara, con la
> instrucción de decir que no hay acceso en vez de estimar. Si algún día se le
> suma un feed social, aplican tal cual.

| Skill | Cuándo lo usa Kaizen |
|---|---|
| [`lectura-kpis-social`](../server/skills/lectura-kpis-social/SKILL.md) | Los 5 KPIs del funnel social + el pulso |
| [`sanidad-datos-social`](../server/skills/sanidad-datos-social/SKILL.md) | Movimiento >20% o dos paneles que no coinciden: distingue tubería rota de realidad rota |
| [`umbrales-semaforo-social`](../server/skills/umbrales-semaforo-social/SKILL.md) | Semáforo verde/ámbar/rojo. **Los umbrales vigentes están PROPUESTOS y sin firmar** por Junior |
| [`top-flop-contenido`](../server/skills/top-flop-contenido/SKILL.md) | Leer resultados de piezas publicadas y decidir qué se repite, pausa o prueba |

⚠️ **Los skills de lectura abren con `search_cerebro`, y las notas de Cerebro de
Junior todavía no están subidas a Drive** (verificado 2026-08-21). Mientras no
estén, buscan, no encuentran y siguen de largo en silencio. Las sube él.

**Candidatos para Fase 2** (cuando llegue la escritura en Meta): adaptar
`ad-creative` del mismo repo MIT.

## Fuentes del ecosistema (por si se buscan más)

- [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) — ~45 skills de marketing, MIT
- [whyashthakker/agent-skills-marketing](https://github.com/whyashthakker/agent-skills-marketing) — 50+ skills, MIT
- [anthropics/skills](https://github.com/anthropics/skills) — repo oficial, Apache 2.0
