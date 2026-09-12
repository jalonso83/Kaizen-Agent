# web/ — la web de socios

> Ver [`../server/README.md`](../server/README.md) para la guía completa del
> backend. Esto es solo el mapa rápido del frontend. Actualizado 2026-09-12.

**Construido:** React + Vite + TS, todo en español, tema claro/oscuro
(`useTheme`, botón en el sidebar). Login (JWT en cookie httpOnly — no es el
login de la app FinZen), y cinco pestañas que se muestran según los permisos
del socio (`server/src/auth/permisos.ts` es la fuente; acá esconder una
pestaña es cortesía, el servidor niega igual con 403):

| Pestaña | Permiso | Qué hay |
|---|---|---|
| Chat | `chat` | Conversaciones, streaming real (`useAgentStream`, mismo parser de SSE que `chatCli.ts`), `ProposalCard` y `GoalCard` con Confirmar/Rechazar (el gate), editar/reintentar mensajes, botón Detener, título automático |
| Metas | `metas:ver` | Historial de metas y las campañas que nacieron bajo cada una |
| Auditoría | `auditoria:ver` | Salud de los jobs, el gate (borradores creados / sin confirmación / denegados), eventos |
| Marketing | `marketing:ver` / `marketing:editar` | **Configuración**: perfiles de Instagram que Kaizen puede leer (persisten en `MarketingAccount`) + enlaces de referencia (aún sin guardar). **Dashboard**: la lectura de cada perfil — seguidores, engagement, últimas piezas, insights de la cuenta propia, y la evolución con deltas a 7/30 días |
| Usuarios | `usuarios:gestionar` | Alta, rol, habilitar/deshabilitar, restablecer contraseña |

Además: ⚙ Configuración del resumen semanal (día/hora, "correr ahora",
reindexar el Cerebro) y cambio de contraseña propia.

**Corre en dev vía Vite** (`npm run dev`, puerto 5173) con proxy a
`localhost:4000` — mismo origen, sin CORS, la cookie viaja normal. En
producción se sirve como estático desde el mismo Express: `npm run build` en
`server/` compila esto y lo copia a `server/public/` (**committeado** — si
cambia algo en `web/src` y no se reconstruye, producción sigue mostrando la
versión vieja; es el bug más repetido del proyecto).

```
web/src/
├── App.tsx                    # Login o Chat según GET /api/auth/me
├── api.ts                     # cliente HTTP (rutas relativas /api/...)
├── types.ts                   # tipos calcados del esquema Prisma y de los servicios del server
├── hooks/
│   ├── useAgentStream.ts      # el parser de SSE
│   └── useTheme.ts            # claro/oscuro
├── pages/
│   ├── LoginPage.tsx
│   ├── ChatPage.tsx           # el layout con sidebar + pestañas
│   ├── MetasPage.tsx
│   ├── AuditPage.tsx
│   ├── MarketingPage.tsx      # Configuración (perfiles + enlaces) y la sub-navegación
│   ├── MarketingDashboard.tsx # el Dashboard: muestra tal cual /api/marketing/instagram/:usuario, no calcula nada
│   └── UsuariosPage.tsx
└── components/
    ├── ConversationList.tsx · ChatView.tsx · Composer.tsx · AgentStatusBar.tsx
    ├── ProposalCard.tsx · GoalCard.tsx
    ├── ConfigDialog.tsx · CambiarPasswordDialog.tsx · ConfirmDialog.tsx
    └── Select.tsx · Icons.tsx
```

**Una regla del Dashboard de Marketing:** ningún número se calcula en el
frontend. Promedios, mediana, tasa de engagement y deltas vienen del server
(`services/instagramAnalisis.ts`), que es el mismo análisis que lee Kaizen por
chat — así el socio nunca ve un número en pantalla distinto del que Kaizen le
cuenta.
