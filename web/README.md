# web/ — chat de socios

> Ver [`../server/README.md`](../server/README.md) para la guía completa del
> backend. Esto es solo el mapa rápido del frontend.

**Construido:** React + Vite + TS. Login (JWT en cookie httpOnly — no es el
login de la app FinZen), lista de conversaciones, chat con streaming real
(`useAgentStream`, mismo parser de SSE que `server/src/scripts/chatCli.ts`),
`ProposalCard` con los botones Confirmar/Rechazar. Todo el texto en español.

**Corre en dev vía Vite** (`npm run dev`, puerto 5173) con proxy a
`localhost:4000` — mismo origen, sin CORS, la cookie viaja normal. En
producción se sirve como estático desde el mismo Express (`web/dist`,
pendiente de conectar en `app.ts`).

**Todavía no funcional:** los botones Confirmar/Rechazar de `ProposalCard`
llaman a `/api/proposals/:id/confirm` y `/reject`, que no existen en el
server hasta que se construya el gate (slice 2 — ver `server/README.md §10`).
Hasta entonces esas dos acciones dan 404; el resto del chat sí funciona
contra el backend real.

```
web/src/
├── App.tsx                # router mínimo: Login o Chat según GET /api/auth/me
├── api.ts                   # cliente HTTP (rutas relativas /api/...)
├── types.ts                   # tipos calcados del esquema Prisma real
├── hooks/useAgentStream.ts      # el parser de SSE
├── pages/{Login,Chat}Page.tsx
└── components/
    ├── ConversationList.tsx
    ├── ChatView.tsx
    ├── Composer.tsx
    ├── ProposalCard.tsx
    └── AgentStatusBar.tsx
```
