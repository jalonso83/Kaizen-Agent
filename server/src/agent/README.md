# src/agent/ — el cerebro de Kaizen

> Ver [`../../README.md`](../../README.md) para la explicación completa y
> actualizada de todo el server (esta nota es solo un mapa rápido de esta
> carpeta puntual).

```
agent/
├── runner.ts        # el loop: toolRunner + streaming + persistencia + stop_reason
├── history.ts        # BD → mensajes válidos para la API; recovery de tool_use huérfanos
├── systemPrompt.ts   # identidad, reglas duras, catálogo de skills
├── adapter.ts         # KaizenTool → betaTool del SDK (único punto, junto a runner.ts, que toca el SDK beta)
├── skills.ts           # loader de ../skills/*/SKILL.md (catálogo + carga por slug)
└── tools/
    ├── guard.ts          # withGuard: audit + timeout 30s + eventos SSE + errores recuperables
    ├── kpis.ts            # get_kpis · get_campaign_results
    ├── segments.ts         # list_segments · evaluate_segment
    ├── skill.ts             # load_skill
    └── index.ts              # registro (TOOL_LIST, TOOLS, runTool)
```

**Construido:** las 5 tools de arriba, el loop completo, el system prompt, y
el loader de skills.

**Todavía no:** `propose_campaign` / `create_campaign_draft` (el gate —
necesitan la tabla `Proposal` usada de verdad + endpoints de confirmación) y
`search_cerebro` / `save_content_draft` (necesitan el indexador del Cerebro).
Van a vivir en `tools/campaigns.ts` y `tools/cerebro.ts` respectivamente. Ver
DISENO_FASE1.md §7 y §9.

Reglas no negociables para toda tool nueva (ya aplicadas en las 5 existentes):
- Pasar por `withGuard` — nunca ejecutar una tool "pelada".
- Errores redactados para que Claude se recupere, no solo para debug humano.
- Timeout 30s; reintentos solo en lecturas, nunca en escrituras.
- Toda llamada queda en el audit log.
