-- Los acentos rompían la búsqueda del Cerebro (hallazgo 2026-08-21).
--
-- El diccionario 'spanish' de Postgres normaliza el acento en ALGUNAS palabras
-- y en otras no, porque el stemmer solo reconoce el sufijo -ción cuando viene
-- acentuado:
--
--     métricas   -> 'metric'      metricas   -> 'metric'        unen
--     retención  -> 'retencion'   retencion  -> 'retencion'     unen
--     atribución -> 'atribu'      atribucion -> 'atribucion'    NO UNEN
--     activación -> 'activ'       activacion -> 'activacion'    NO UNEN
--     comparación-> 'compar'      comparacion-> 'comparacion'   NO UNEN
--
-- O sea: un documento escrito sin tildes era inencontrable con una consulta
-- acentuada, y al revés. Y "activación" es el norte del negocio de FinZen, así
-- que el caso roto no era marginal. Los nombres de archivo son el peor caso:
-- casi nunca llevan tilde.
--
-- POR QUÉ unaccent VA DENTRO DE LA CONFIGURACIÓN Y NO EN LA EXPRESIÓN:
-- la columna generada exige una expresión IMMUTABLE, y la función unaccent()
-- es STABLE (depende del diccionario, que se puede recargar), así que llamarla
-- directo en el GENERATED ALWAYS AS falla. En cambio to_tsvector(regconfig,
-- text) —la forma de DOS argumentos, con la configuración explícita— sí es
-- IMMUTABLE. Por eso unaccent se mete en el mapeo de la configuración y la
-- expresión solo nombra 'es_kaizen'.
--
-- Igual que en 20260812120000: la expresión de una columna generada no se puede
-- alterar, se dropea y se recrea, y el índice GIN cae con ella.
--
-- NO hace falta reindexar el Cerebro desde Drive (verificado 2026-08-21): al
-- hacer ADD COLUMN de una generada STORED, Postgres reescribe la tabla y calcula
-- el valor para TODAS las filas existentes a partir de `name` y `text`, que no
-- se tocan. Los documentos ya guardados quedan re-tokenizados con es_kaizen en
-- cuanto corre esta migración.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Copia de 'spanish' con unaccent antes del stemmer. Se recrea de cero para que
-- la migración sea repetible.
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
