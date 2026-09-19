# Kaizen — Agente de Crecimiento de FinZen AI

Kaizen es un agente de crecimiento autónomo y conversacional: lee los KPIs del
negocio, conversa con los socios en lenguaje natural, encuentra segmentos de
usuarios y propone campañas; del lado de marketing, lee las cuentas de redes
(Instagram por ahora) y la pauta en Meta, y genera conceptos de contenido.
**Un humano siempre aprueba antes de que se envíe o publique nada.**

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
> 📓 La bitácora de la **Fase 2** (Meta, la capa de lectura de Junior, el
> sistema de marca, Marketing e Instagram) es
> **[`docs/ESTADO_FASE_2.md`](docs/ESTADO_FASE_2.md)**; los skills y sus dos
> ámbitos, **[`docs/SKILLS.md`](docs/SKILLS.md)**.
>
> ☁️ Drive escribe por OAuth de usuario (la service account solo puede leer —
> limitación de Google). Cómo se configuró: **[`docs/DRIVE_OAUTH.md`](docs/DRIVE_OAUTH.md)**.
>
> 🛠️ **Cómo funciona lo que ya está construido** (arquitectura, capa por
> capa, cómo correrlo) está en **[`server/README.md`](server/README.md)** y
> **[`web/README.md`](web/README.md)** — este README raíz es solo la
> puerta de entrada.

## Estructura

```
Kaizen-Agent/
├── docs/                  # PRD, diseño de Fase 1, ESTADO (Fase 1) y ESTADO_FASE_2, SKILLS, cerebro/
├── server/
│   ├── skills/            # 17 playbooks en dos ámbitos: finzen/ (8) y marketing/ (9) — ver docs/SKILLS.md
│   ├── prisma/            # schema + 16 migraciones SQL (se aplican con prisma migrate deploy)
│   ├── public/            # la web compilada (committeada; la regenera npm run build)
│   └── src/
│       ├── app.ts            # Express: rutas, estático de la web, arranque de los crons
│       ├── config.ts         # Env vars validadas al boot
│       ├── auth/permisos.ts  # roles → permisos: LA fuente de verdad de quién puede qué
│       ├── clients/          # finzenApi (Agent API) · drive · graphApi/metaApi/instagramApi · tiktokApi · vision · documentos
│       ├── routes/           # auth · chat · proposals · goals · goalsHistory · audit · config · users · marketing
│       ├── services/         # audit (append-only) · instagramAnalisis (un solo análisis para chat y dashboard) · acquisitionExport
│       ├── jobs/             # cerebroIndex (boot + 6h) · weeklySummary (lunes) · acquisitionExport (lunes) · instagramSnapshot (diario)
│       ├── agent/            # el loop, las 19 tools, el system prompt, los dos ámbitos, el loader de skills
│       ├── tests/            # npm test (tsx --test): lógica pura, sin BD ni red
│       └── scripts/          # seedPartners · chatCli (chat por consola) · testTools
└── web/                   # Web de socios — React + Vite: chat, metas, auditoría, marketing, usuarios
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
commitean (el `.gitignore` ya protege `.env` y los JSON de service accounts) y
**nunca viajan por chat, WhatsApp ni correo**: van directo a las variables de
Railway. Las de Meta/Instagram (`META_SYSTEM_TOKEN`, `META_AD_ACCOUNT_ID`,
`INSTAGRAM_ACCOUNT_ID`) y las de TikTok (`TIKTOK_CLIENT_KEY`,
`TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`) están pendientes de FinZen a 2026-09-18.

## Migraciones

**No se aplican solas en el deploy** (el `start` es `node dist/app.js`; hay un
commit del 19-jul que dice lo contrario y no lo hace). Quien administre Railway
corre `railway run npx prisma migrate deploy` después de cada cambio en
`server/prisma/migrations/`. A 2026-09-17 hay **una pendiente** en producción
(`20260917100000_marketing_link`, enlaces de Marketing) y a 2026-09-18 otra
(`20260918100000_tiktok`, credencial e histórico de TikTok).

## Reglas del proyecto

- **UI y mensajes siempre en español.**
- El agente **nunca envía nada**: solo crea borradores `PENDING_APPROVAL` que
  un humano aprueba en el panel de FinZen.
- Nunca inventar números: todo dato sale de la Agent API.
- Nada de PII: la Agent API solo devuelve agregados, y así se queda.
- Cada acción contra FinZen/Drive/Meta/Instagram queda en el audit log.
- Los candados de verdad son de código, no de prompt: el gate de confirmación,
  la lista blanca del contrato, Meta solo lectura, Instagram solo sobre
  perfiles guardados. El prompt instruye; el código garantiza.
- Un fallo se dice ("omitido", "no disponible: motivo"), nunca se traga.
- Si cambia algo en `web/src`, se corre `npm run build` en `server/` y se
  commitea `server/public/` — si no, producción sigue con la web vieja.
- Trabajo en ramas + Pull Request; `main` está protegida.
