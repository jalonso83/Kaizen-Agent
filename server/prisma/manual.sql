-- Blindaje de BD que Prisma no expresa — DISENO_FASE1.md §1 ("esto ES el blindaje").
-- Aplicar DESPUÉS de `prisma migrate dev` (o incluirlo como una migración SQL propia):
--   psql "$DATABASE_URL" -f prisma/manual.sql
-- Es idempotente (CREATE OR REPLACE / IF NOT EXISTS donde aplica).

-- 1. Audit log append-only: ni un bug puede editar/borrar filas.
CREATE OR REPLACE FUNCTION audit_no_touch() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog es inmutable (append-only)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_immutable ON "AuditLog";
CREATE TRIGGER audit_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_no_touch();

-- 2. Índice full-text del Cerebro (español) para search_cerebro (§9).
ALTER TABLE "CerebroDoc"
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', name || ' ' || text)) STORED;

CREATE INDEX IF NOT EXISTS cerebro_tsv_idx ON "CerebroDoc" USING GIN (tsv);
