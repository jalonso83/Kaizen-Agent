# docs/cerebro/ — notas que escribimos nosotros para el Cerebro

El Cerebro (Drive) es donde vive la **información**; el repo es donde vive el
**método** (`server/skills/`) y el código. Esa separación es la defensa contra
prompt-injection de la Fase 1 y no se toca (ver `docs/SKILLS.md`).

Pero hay notas de información que **escribimos nosotros**, no marketing ni
Junior: reconciliaciones, convenciones, aclaraciones de cifras. Esas necesitan
pasar por un PR revisable antes de subirse, y por eso el borrador vive acá.

**Cómo funciona:**

1. La nota se escribe y se revisa acá, en el PR.
2. Se sube a la carpeta del Cerebro que indica su encabezado.
3. La copia de Drive es la que **lee Kaizen**. Esta es solo el borrador
   revisable.

⚠️ **Las dos copias pueden divergir.** Si alguien edita la nota en Drive, este
archivo queda viejo y nadie se entera. Quien la edite en Drive actualiza acá en
el mismo día, o al revés. Si divergen, **manda la de Drive**, porque es la que
el agente de verdad está leyendo — pero eso es un fallo del proceso, no el
funcionamiento normal.

## La convención `Ventana de datos:`

Toda nota de este directorio —y ojalá toda nota del Cerebro que contenga
cifras— lleva en las primeras líneas:

```
Ventana de datos: <el período que cubren SUS cifras>
```

`search_cerebro` la lee y se la pasa al modelo aparte de la fecha del archivo
(`server/src/agent/tools/cerebro.ts`). Existe porque la fecha de Drive es
**cuándo se editó el archivo**, no **de cuándo son sus datos**: una nota con
cifras de julio editada en agosto se lee como "agosto" y el modelo la compara
contra otra de agosto como si midieran lo mismo.

Se aceptan también `Ventana:`, `Período:`/`Periodo:` y `Cubre:`. Una nota sin la
línea sigue funcionando igual que antes.

## Contenido

| Nota | Sube a | Qué resuelve |
|---|---|---|
| [`finzen-cifras-ventanas-y-cac.md`](finzen-cifras-ventanas-y-cac.md) | `10-decisiones/` | El conflicto de CAC/pagos/retención entre el Diagnóstico de Activación (jul) y las notas de Junior (ago) |

[`de-junior/`](de-junior/) es distinto: no son notas nuestras. Son las de Junior,
con la línea `Ventana de datos:` agregada y nada más tocado, listas para que
alguien las suba a Drive. Tienen su propio README.
