# SKILLS.md — Los skills de Kaizen

**Versión 1.0 · 2026-07-12**

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

## Mecánica (a construir en Fase 1 — ver DISENO_FASE1.md §15)

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

## Catálogo actual

| Skill | Cuándo lo usa Kaizen | Origen |
|---|---|---|
| [`campanas-retencion`](../server/skills/campanas-retencion/SKILL.md) | Diseñar campañas para reactivar/retener usuarios (dormidos, nunca activados, trial por vencer) | Adaptado de `churn-prevention` (coreyhaines31/marketingskills, MIT) |
| [`copy-push`](../server/skills/copy-push/SKILL.md) | Redactar el mensaje de una campaña push/slot (≤200 chars) | Adaptado de `copywriting` + `sms` (coreyhaines31/marketingskills, MIT) |
| [`diseno-experimentos`](../server/skills/diseno-experimentos/SKILL.md) | Definir holdout, hipótesis y lectura de lift de una campaña; interpretar resultados | Adaptado de `ab-testing` (coreyhaines31/marketingskills, MIT) |
| [`conceptos-contenido`](../server/skills/conceptos-contenido/SKILL.md) | Crear conceptos de contenido externo (reels, carruseles, guiones) para Contenidos | Adaptado de `social` (coreyhaines31/marketingskills, MIT) |
| [`resumen-semanal`](../server/skills/resumen-semanal/SKILL.md) | El formato y criterios del reporte semanal automático (cron del lunes) | Propio de Kaizen |

**Candidatos para Fase 2** (cuando llegue Meta): adaptar `ads` y `ad-creative`
del mismo repo MIT.

## Fuentes del ecosistema (por si se buscan más)

- [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) — ~45 skills de marketing, MIT
- [whyashthakker/agent-skills-marketing](https://github.com/whyashthakker/agent-skills-marketing) — 50+ skills, MIT
- [anthropics/skills](https://github.com/anthropics/skills) — repo oficial, Apache 2.0
