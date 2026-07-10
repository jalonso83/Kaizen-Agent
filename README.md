# Kaizen — Agente de Crecimiento de FinZen AI

Kaizen es un agente de crecimiento autónomo y conversacional: lee los KPIs del
negocio, conversa con los socios en lenguaje natural, encuentra segmentos de
usuarios y propone campañas. **Un humano siempre aprueba antes de que se envíe
o publique nada.**

Este es un proyecto **independiente** de FinZen: repo, deploy y credenciales
propios. Toda la comunicación con FinZen pasa por la Agent API (API Key + 3
endpoints). **No** se toca el código ni la base de datos de FinZen.

> 📄 El documento de referencia es el PRD: **[`docs/PRD_Kaizen.md`](docs/PRD_Kaizen.md)** —
> fases, contratos de la API, guardarraíles y criterios de aceptación.
> Léelo completo antes de escribir código.

## Estructura

```
Kaizen-Agent/
├── server/          # Backend: orquestador del agente (loop de Claude), API del chat
│   └── src/
│       ├── app.ts       # Express — /health y (Fase 1) /chat
│       ├── config.ts    # Env vars validadas al boot
│       ├── check.ts     # Smoke tests de conexiones (npm run check)
│       ├── clients/     # finzenApi.ts (Agent API) · drive.ts (Cerebro)
│       └── agent/       # (Fase 1) loop de Claude, tools, system prompt
└── web/             # (Fase 1) Chat de socios — React
```

## Arranque (día 1)

```bash
cd server
npm install
cp .env.example .env    # y completa las variables (te las da FinZen)
npm run check           # smoke tests: FinZen API, Anthropic, Drive
npm run dev             # server en http://localhost:4000/health
```

## Variables de entorno

Ver `server/.env.example`. Las credenciales las entrega FinZen — **nunca** se
commitean (el `.gitignore` ya protege `.env` y los JSON de service accounts).

## Reglas del proyecto

- **UI y mensajes siempre en español.**
- El agente **nunca envía nada**: solo crea borradores `PENDING_APPROVAL` que
  un humano aprueba en el panel de FinZen.
- Nunca inventar números: todo dato sale de la Agent API.
- Nada de PII: la Agent API solo devuelve agregados, y así se queda.
- Cada acción contra FinZen/Drive/Meta queda en el audit log (Fase 1).
- Trabajo en ramas + Pull Request; `main` está protegida.
