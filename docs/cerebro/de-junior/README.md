# Notas de Junior, listas para subir al Cerebro

Las escribió **Junior**, no nosotros. Acá están sus notas de las dos entregas
del 2026-08-20 con **una sola cosa cambiada**: dos líneas agregadas al
encabezado (`Ventana de datos:` y `Sube a:`). Ni una palabra del contenido se
tocó — verificable con `diff` contra los originales, que siguen intactos en
[`docs/recibido/`](../../recibido/).

**Por qué se agregó la ventana:** las notas traen `Actualizado: 2026-08-20`,
que es cuándo Junior las escribió, no de cuándo son sus cifras (corte del
17-ago, y las de campañas son lifetime). `search_cerebro` ahora lee esa línea y
se la pasa al modelo aparte de la fecha del archivo — la convención está en
[`../README.md`](../README.md). Es exactamente el problema que produjo los dos
CAC distintos entre el Diagnóstico de Activación y estas notas.

## Qué sube y a dónde

| Nota | Carpeta | Búsquedas de skills que responde |
|---|---|---|
| `definiciones-metricas-finzen.md` | `00-nucleo/` | `"definiciones de métricas"` |
| `finzen-glosario-y-trampas-de-metricas.md` | `00-nucleo/` | `"glosario métricas FinZen"` |
| `rupturas-de-serie-y-baselines.md` | `00-nucleo/` | `"rupturas de serie"` — la usan **cuatro** skills |
| `umbrales-vigentes-y-propuestos.md` | `10-decisiones/` | `"umbrales vigentes"` |
| `finzen-umbrales-y-decisiones.md` | `10-decisiones/` | `"<nombre del experimento>"`, `"experimentos activos FinZen"` |
| `decisiones-cerradas-no-relitigar.md` | `10-decisiones/` | `"pausado"`, `"decisiones de contenido"` |

## La que NO sube

**`finzen-rupturas-de-serie.md`** (entrega A) se queda fuera a propósito: trae
las mismas 7 rupturas de producto que `rupturas-de-serie-y-baselines.md`, y esa
además agrega la capa social. Con las dos arriba,
`search_cerebro("rupturas de serie")` devuelve dos archivos casi idénticos y
Kaizen cita el que gane el ranking, sin forma de que nadie sepa cuál usó.
Decisión ya tomada en `docs/ESTADO_FASE_2.md` ("Pendiente con Junior" #5).

## Lo que esto NO arregla

Dos búsquedas que los skills ejecutan y que ninguna de estas notas responde:

- `search_cerebro("atribución UTM tienda FinZen")` — la ambigüedad de
  atribución sigue abierta (las 3 suscripciones que caen en "Directo").
  Mientras siga así, ninguna afirmación de ROI de campaña es defendible.
- `search_cerebro("tono de voz")` — no es de Junior: es el manual de marca, que
  hoy vive en `Contenidos/` y por eso el indexador no lo ve. Ver el hallazgo del
  2026-09-03 en `docs/ESTADO_FASE_2.md`.

## Al subirlas

Verificar que el indexado las tomó (botón **Reindexar el Cerebro** en
Configuración) y que `search_cerebro("rupturas de serie")` las devuelve. Si
Junior las edita en Drive después, esta copia queda vieja: manda la de Drive, y
conviene actualizar acá el mismo día.
