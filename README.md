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
>
> 🧭 El estado vivo del proyecto (qué está hecho, qué sigue, infra) está en
> **[`docs/ESTADO.md`](docs/ESTADO.md)** — es lo primero que debe leer
> cualquier persona o agente que retome el trabajo, y se actualiza en el
> mismo commit que cambie el estado.
>
> 🛠️ **Cómo funciona lo que ya está construido** (arquitectura, capa por
> capa, cómo correrlo) está en **[`server/README.md`](server/README.md)** y
> **[`web/README.md`](web/README.md)** — este README raíz es solo la
> puerta de entrada.

## Estructura

```
Kaizen-Agent/
├── server/
│   ├── skills/            # 5 playbooks de marketing (ver docs/SKILLS.md)
│   └── src/
│       ├── app.ts            # Express — /health, /api/auth, /api/conversations
│       ├── config.ts          # Env vars validadas al boot
│       ├── check.ts            # Smoke tests de conexiones (npm run check)
│       ├── clients/             # finzenApi.ts (Agent API) · drive.ts (Cerebro)
│       ├── routes/               # auth.ts · chat.ts
│       ├── middleware/            # requireAuth.ts · asyncRoute.ts
│       ├── scripts/                # seedPartners.ts · chatCli.ts (chat por consola)
│       └── agent/                   # el loop, las tools, el system prompt, el loader de skills
└── web/                # Chat de socios — React + Vite (dev: npm run dev, puerto 5173)
```

## Arranque (día 1)

```bash
cd server
npm install
cp .env.example .env        # y completa las variables (te las da FinZen)
npx prisma migrate deploy   # crea las tablas + el blindaje
npm run check                # smoke tests: FinZen API, Anthropic, Drive
npm run seed:partner -- --email=vos@finzen.ai --name="Tu Nombre"
npm run dev                   # server en http://localhost:4000/health
```

`npm run dev` queda corriendo en primer plano — para hablar con el agente, abrí **otra terminal** (con el server de arriba seguir corriendo) y desde ahí:

```bash
cd server && npm run chat                              # consola
# o, en una tercera terminal:
cd web && npm install && npm run dev                    # web, puerto 5173
```

Guía de pruebas paso a paso, capa por capa: [`TESTING.md`](TESTING.md).

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
