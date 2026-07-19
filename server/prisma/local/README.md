# BD de Kaizen — server (prod) y local

## Server / producción — PostgreSQL en Railway (DISENO_FASE1.md §0.1, ESTADO.md)

El server usa **PostgreSQL**. Las migraciones ya están generadas en
`prisma/migrations/` (init + hardening). No hay que escribir SQL a mano:

```bash
# En Railway: agregar un plugin Postgres → copia su DATABASE_URL al servicio Kaizen.
# Luego, una sola vez (o en el paso de deploy):
npx prisma migrate deploy       # crea las tablas (init) + trigger/FTS (hardening)
```

`migrate deploy` aplica ambas migraciones, incluido el blindaje append-only del
audit log y el índice full-text en español del Cerebro. Nada manual.

> Si prefieres correr el SQL crudo directo (sin Prisma), los mismos comandos
> están en `prisma/migrations/*/migration.sql` y en `prisma/manual.sql`.

## Local — opción recomendada: PostgreSQL (idéntico a prod)

La forma que evita TODA divergencia (mismo provider, mismo full-text). Con Docker:

```bash
docker run --name kaizen-pg -e POSTGRES_PASSWORD=kaizen -e POSTGRES_DB=kaizen \
  -p 5432:5432 -d postgres:16

# en server/.env
DATABASE_URL="postgresql://postgres:kaizen@localhost:5432/kaizen"

npx prisma migrate dev          # crea tablas + aplica init y hardening
```

Con esto, `search_cerebro` y el trigger del audit log se comportan **igual que en
producción**. Es la opción recomendada.

## Local — alternativa: MySQL 8 (o SQL Server)

Si no puedes usar Postgres local, hay un script en `prisma/local/setup_mysql.sql`.
**Dos advertencias** (detalladas en el encabezado del script):

1. **Prisma usa un solo provider.** Para correr la app contra MySQL hay que
   cambiar `provider = "mysql"` en `schema.prisma` y `prisma generate`. No mezcles
   el `.sql` con Prisma sobre la misma BD.
2. **`search_cerebro` no traduce.** El full-text `tsvector('spanish')` es de
   Postgres; en MySQL la tool debe usar el fallback `LIKE` de DISENO §9. El
   índice `FULLTEXT` del script es un apaño básico, no equivale al ranking en
   español de prod.

```bash
mysql -u root -p < prisma/local/setup_mysql.sql
# en server/.env
DATABASE_URL="mysql://root:TU_PASSWORD@localhost:3306/kaizen"
```

**SQL Server:** no incluido por defecto (usa `NVARCHAR(MAX)` para JSON, triggers
`INSTEAD OF` con `THROW`, y Full-Text Search como feature aparte). Si lo
necesitas, pídelo y genero el `setup_sqlserver.sql` equivalente.

## El blindaje que NINGUNA opción debe perder

- **AuditLog append-only**: trigger que aborta UPDATE/DELETE (garantía de BD, no
  de código). Presente en Postgres (hardening) y en el script MySQL.
- **Nada de secretos en estos archivos.** `DATABASE_URL` va en `.env` (local) o en
  las variables de Railway (prod), nunca commiteado.
