# src/agent/ — el cerebro de Kaizen (Fase 1)

Aquí vive el orquestador del agente. Estructura prevista (PRD §1):

```
agent/
├── loop.ts          # tool runner de Claude (@anthropic-ai/sdk, claude-opus-4-8, adaptive thinking)
├── systemPrompt.ts  # identidad, contexto del negocio, reglas duras, estilo de propuestas
└── tools/           # get_kpis · list_segments · evaluate_segment ·
                     # create_campaign_draft (con gate de confirmación) ·
                     # search_cerebro · save_content_draft
```

Reglas no negociables para las tools (PRD §1.2 y §1.6):
- Validar inputs; errores con `is_error: true` para que Claude se recupere.
- Loggear TODA llamada en el audit log.
- `create_campaign_draft` solo se ejecuta tras confirmación explícita del socio.
- Timeout 30s por llamada HTTP; reintentos solo en lecturas.
