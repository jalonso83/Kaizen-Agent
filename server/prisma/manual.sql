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
--
-- `translate` es lo que hace buscable el NOMBRE: el parser de Postgres ve
-- "2026-08-12-prueba-indexador.md" como un token `host` (el ".md" le parece un
-- dominio) y lo guarda como UN lexema indivisible, así que "prueba" e
-- "indexador" nunca entraban al índice. Pasa con todos los nombres del Cerebro.
-- Convertir -_. en espacios hace que el parser vea palabras sueltas.
--
-- Y el nombre pesa más que el texto (setweight 'A' vs 'B' = 1.0 vs 0.4 con los
-- pesos por defecto de ts_rank), para que una nota corta sobre el tema le gane a
-- un digest de 90 KB que lo menciona de pasada. Ambos, hallazgo 2026-08-12.
--
-- Se DROPEA y se recrea porque la expresión de una columna generada no se puede
-- alterar; el índice cae con la columna, por eso se recrea después. La tabla la
-- repuebla el indexador, no hay datos que perder.
--
-- 'es_kaizen' (migración 20260821120000) es 'spanish' + unaccent: el stemmer de
-- Postgres solo recorta el sufijo -ción cuando viene acentuado, así que sin esto
-- "atribución" y "atribucion" son lexemas distintos y no unen. unaccent va en la
-- configuración y NO en la expresión porque la columna generada exige IMMUTABLE
-- y unaccent() es STABLE; to_tsvector(regconfig, text) sí es IMMUTABLE.
CREATE EXTENSION IF NOT EXISTS unaccent;

DROP TEXT SEARCH CONFIGURATION IF EXISTS es_kaizen;
CREATE TEXT SEARCH CONFIGURATION es_kaizen (COPY = spanish);
ALTER TEXT SEARCH CONFIGURATION es_kaizen
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, spanish_stem;

ALTER TABLE "CerebroDoc" DROP COLUMN IF EXISTS tsv;

ALTER TABLE "CerebroDoc"
  ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('es_kaizen', translate(coalesce(name, ''), '-_.', '   ')), 'A') ||
    setweight(to_tsvector('es_kaizen', coalesce(text, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS cerebro_tsv_idx ON "CerebroDoc" USING GIN (tsv);
