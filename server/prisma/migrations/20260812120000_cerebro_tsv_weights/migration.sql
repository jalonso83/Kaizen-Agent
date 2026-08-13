-- Arregla la búsqueda por nombre de archivo en el Cerebro (hallazgo 2026-08-12:
-- buscar "prueba indexador" NO devolvía "2026-08-12-prueba-indexador.md").
--
-- Son dos problemas, y el primero es el que de verdad rompía todo:
--
-- 1. EL NOMBRE NO SE TOKENIZABA. El parser de Postgres ve
--    "2026-08-12-prueba-indexador.md" y lo clasifica como token `host` —el ".md"
--    final le parece un dominio— así que lo guarda como UN lexema indivisible:
--    '2026-08-12-prueba-indexador.md'. Las palabras "prueba" e "indexador"
--    nunca existieron en el índice. Pasa con TODOS los nombres del Cerebro
--    (mtp-y-norte.md, decisions-log.md, ...): el nombre estaba en la columna
--    desde el día uno pero no se podía buscar salvo escribiéndolo entero y
--    exacto. `translate` convierte -_. en espacios para que el parser vea
--    palabras sueltas.
--
-- 2. El nombre pesaba igual que el cuerpo. setweight 'A' para el nombre y 'B'
--    para el texto: con los pesos por defecto de ts_rank, 1.0 contra 0.4. Así
--    una nota corta que trata del tema le gana a un digest de 90 KB que lo
--    menciona de pasada.
--
-- La expresión de una columna generada no se puede alterar, así que se dropea y
-- se recrea. El índice GIN cae junto con la columna y se recrea abajo. No se
-- pierden datos: la columna es derivada y la tabla la repuebla el indexador.
--
-- Mismo contenido que el bloque 2 de prisma/manual.sql, a propósito: va acá para
-- que `prisma migrate deploy` lo aplique solo en Railway, en vez de depender de
-- que alguien se acuerde de correr el .sql a mano.
ALTER TABLE "CerebroDoc" DROP COLUMN IF EXISTS tsv;

ALTER TABLE "CerebroDoc"
  ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', translate(coalesce(name, ''), '-_.', '   ')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(text, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS cerebro_tsv_idx ON "CerebroDoc" USING GIN (tsv);
