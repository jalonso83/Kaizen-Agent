-- Roles de socio. Ver server/src/auth/permisos.ts para la tabla rol → permisos.

ALTER TABLE "Partner" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE "Partner" ADD COLUMN "createdBy" TEXT;

-- Los socios que YA existen tenían acceso completo antes de que hubiera roles.
-- Dejarlos caer al default 'USER' les quitaría de golpe la auditoría, la
-- configuración y el gate de campañas — y, peor, dejaría el sistema sin ningún
-- ADMIN, o sea sin nadie que pueda repartir roles: un lockout total.
-- Una migración no puede quitar acceso que la gente ya tenía en silencio.
UPDATE "Partner" SET "role" = 'ADMIN';
