# src/agent/ — el cerebro de Kaizen

> Ver [`../../README.md`](../../README.md) para la explicación completa del
> server (esta nota es solo un mapa rápido de esta carpeta). Actualizado
> 2026-09-12.

```
agent/
├── runner.ts         # el loop: toolRunner + streaming + persistencia + stop_reason + abort
├── history.ts        # BD → mensajes válidos para la API; recovery de tool_use huérfanos
├── contexto.ts       # el bloque <contexto> del turno (fecha RD + meta vigente) — nunca en el system prompt
├── systemPrompt.ts   # identidad, 15 reglas duras, sección de ámbitos (tools + skills, GENERADA del registro)
├── ambitos.ts        # los dos ámbitos (finzen / marketing): la única definición
├── skills.ts         # loader de ../skills/<ambito>/*/SKILL.md (catálogo por ámbito + carga por slug)
├── tono.ts           # el tono de marca: del Cerebro (00-nucleo) o el respaldo del repo (tonoFallback.ts)
├── autoTitle.ts      # título automático de la conversación (Haiku)
├── adapter.ts        # KaizenTool → betaTool del SDK (único punto, junto a runner.ts, que toca el SDK beta)
└── tools/
    ├── guard.ts      # withGuard: audit + timeout 30s + eventos SSE + errores recuperables; LABELS de la barra de estado
    ├── index.ts      # registro: TOOL_LIST, CRON_TOOL_LIST (sin escritura a FinZen), TOOLS, runTool
    ├── kpis.ts       # get_kpis · get_campaign_results                                   [finzen]
    ├── segments.ts   # list_segments · evaluate_segment                                  [finzen]
    ├── campaigns.ts  # propose_campaign · create_campaign_draft (el gate) · get_message_type_performance [finzen]
    ├── goals.ts      # propose_goal · get_active_goal · mark_goal_achieved                [finzen]
    ├── meta.ts       # get_meta_campaigns · get_meta_spend (solo lectura)                [marketing]
    ├── instagram.ts  # list_marketing_accounts · get_instagram_profile (solo lectura)   [marketing]
    ├── cerebro.ts    # search_cerebro · save_cerebro_note · list_cerebro_folders [comun] · save_content_draft [marketing]
    └── skill.ts      # load_skill                                                        [comun]
```

**19 tools.** Cada una declara su `ambito` (`finzen` = la app y su tablero,
`marketing` = redes, contenido y pauta, `comun` = sirve en los dos); el
campo es obligatorio en el tipo `KaizenTool`, y `systemPrompt.ts` arma la
sección "Tus dos ámbitos" leyendo ese campo y la carpeta de cada skill. No hay
una lista escrita a mano que mantener: agregar una tool o un skill en su lugar
la hace aparecer en el prompt sola. Ver `docs/SKILLS.md` → "Los dos ámbitos".

**Candados que son de código, no de prompt** (DISENO §7, ESTADO_FASE_2):
- `create_campaign_draft` solo acepta un `proposal_id` en estado `CONFIRMED`,
  y a `CONFIRMED` solo se llega por el botón de la tarjeta (HTTP), nunca por
  una tool. `propose_campaign` verifica el `segment_count` contra las llamadas
  reales a `evaluate_segment` de la conversación (`verificarSegmentCount`).
- Toda respuesta de FinZen pasa por la lista blanca del contrato
  (`clients/proyeccion.ts`) antes de llegar al modelo.
- Meta es solo lectura (`META_WRITE_ENABLED=false`); Instagram solo lee
  perfiles guardados en Marketing → Configuración.
- `CRON_TOOL_LIST` excluye las tools de escritura hacia FinZen: un cron no
  *puede* crear borradores ni metas, ni por un bug de prompt.

Reglas no negociables para toda tool nueva:
- Pasar por `withGuard` — nunca ejecutar una tool "pelada".
- Declarar `ambito`. Si sirve en los dos lados es `comun`; si no sabés cuál
  es, es que cubre dos cosas y son dos tools.
- Errores redactados para que Claude se recupere ("NO reintentes: dile al
  socio que…"), no solo para debug humano.
- Los avisos de cómo leer mal el dato viajan CON el dato (patrón de `kpis.ts`,
  `meta.ts`, `instagram.ts`), no solo en el system prompt.
- Timeout 30s; reintentos solo en lecturas, nunca en escrituras.
- Toda llamada queda en el audit log.
- Agregar su etiqueta a `LABELS` en `guard.ts` (la barra "Kaizen está…").
