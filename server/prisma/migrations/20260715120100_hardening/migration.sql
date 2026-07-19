-- Blindaje de BD que Prisma no expresa en el esquema — DISENO_FASE1.md §1.
-- Se corre como su propia migración (después del init), así `migrate deploy`
-- lo aplica en Railway sin pasos manuales. Es la MISMA lógica que prisma/manual.sql.

-- 1. Audit log append-only: un trigger aborta cualquier UPDATE/DELETE sobre la tabla.
--    La garantía de inmutabilidad es de la BD, no de la disciplina del código.
CREATE OR REPLACE FUNCTION audit_no_touch() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog es inmutable (append-only)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_immutable ON "AuditLog";
CREATE TRIGGER audit_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_no_touch();

-- 2. Índice full-text del Cerebro (config 'spanish') para search_cerebro (DISENO §9).
--    Columna generada tsvector + índice GIN. La búsqueda usa plainto_tsquery('spanish', ...).
ALTER TABLE "CerebroDoc"
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', name || ' ' || text)) STORED;

CREATE INDEX IF NOT EXISTS cerebro_tsv_idx ON "CerebroDoc" USING GIN (tsv);
