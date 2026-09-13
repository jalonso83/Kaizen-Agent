---
name: lectura-perfil-instagram
description: Úsalo SIEMPRE después de llamar a get_instagram_profile y antes de decirle al socio qué significa lo que salió — "cómo va el Instagram", "qué tal la tasa de engagement", "cómo estamos contra el competidor X", "qué pieza funcionó". Convierte el JSON de la tool en una lectura honesta: qué es pulso y qué es funnel, cuándo un número es bueno para una cuenta de ESE tamaño, cuándo un delta es ruido. Para el método general de KPIs sociales (funnel de 5, madurez de ventana) el skill es lectura-kpis-social; para fijar semáforos, umbrales-semaforo-social.
---

# Lectura de un perfil de Instagram

`get_instagram_profile` ya trae los números calculados (promedios, mediana, tasa, deltas). Lo que no trae es el criterio: si 2,3 % de engagement es bueno o malo depende del tamaño de la cuenta, si "+40 seguidores" es señal o ruido depende de cuántos tiene, y si el reel con más likes "funcionó" no lo dice ningún like. Este skill es ese criterio. El resultado es una lectura que el socio pueda usar sin haber mirado el JSON.

## 0. Antes de empezar

1. `get_instagram_profile` (sin parámetros para FinZen; con `usuario` para un tercero guardado). Nunca leas de memoria ni de una lectura de otra conversación.
2. `search_cerebro("umbrales vigentes")` — si hay umbral firmado para la métrica, se APLICA. Los rangos de referencia del §2 son para orientar cuando NO hay umbral, y se dicen como tales.
3. Si el socio pregunta "cuántos registros trajo" o "cuánto vale en usuarios": `get_kpis` del mismo periodo para `acquisition.by_source` (ámbito FinZen). La tool de Instagram no sabe de registros; el cruce lo hacés vos y decís de dónde sale cada dato.
4. Si el socio pregunta "por qué" cambió algo: `search_cerebro("rupturas de serie")` y `search_cerebro("decisiones de contenido")` antes de inventar una causa.

## 1. Qué mirar primero (el orden importa)

| Orden | Campo | Qué es | Peso en la lectura |
|---|---|---|---|
| 1 | `insights` (solo FinZen) | alcance, guardados, compartidos, taps al link, altas/bajas | **Funnel.** Decide. Si `no_disponible` trae algo, dilo primero: la lectura queda a media máquina |
| 2 | `historico.delta_7d` / `delta_30d` | cambio contra lecturas guardadas | **Tendencia.** Vale más que cualquier foto |
| 3 | `tasa_engagement_pct` + `likes_mediana` | interacciones por pieza sobre seguidores; el centro real de la distribución | **Salud relativa.** Comparable entre cuentas de tamaño parecido |
| 4 | `resumen_publicaciones.por_tipo` y `piezas_por_semana` | mezcla REELS/FEED y ritmo | **Diagnóstico.** Explica el número, no lo reemplaza |
| 5 | `top`, `likes_promedio`, `publicaciones` | las piezas y sus likes | **Pulso.** Contextualiza; nunca es la conclusión |

Regla de oro: **una lectura que solo tiene pulso lo dice en la primera línea** ("solo lo público: sin alcance ni guardados"). No se compensa con adjetivos.

## 2. Referencias de tamaño (orientativas, NO umbrales)

La tasa de engagement de esta tool es *interacciones promedio por pieza / seguidores × 100*. Cae con el tamaño de la cuenta: comparar una cuenta de 3.000 seguidores con una de 300.000 por la tasa a secas es un error de escala.

| Seguidores | Tasa típica del sector (referencia general, no de FinZen) | Cómo usarla |
|---|---|---|
| < 10.000 | 3 – 6 % | Debajo de 2 % la cuenta no mueve a su audiencia; arriba de 6 % suele haber comunidad real o una pieza viral en la muestra (mirá la mediana) |
| 10.000 – 100.000 | 1,5 – 3,5 % | Rango donde caen la mayoría de las cuentas de marca activas |
| > 100.000 | 0,8 – 2 % | Normal que sea baja; leer alcance y guardados, no la tasa |

Estos rangos son de benchmarks externos y **no valen como semáforo**: el skill `umbrales-semaforo-social` prohíbe copiar benchmarks sin pasar por el histórico propio. Se citan así: "para una cuenta de este tamaño lo típico es X–Y; el umbral de FinZen no está firmado". Cuando haya 4+ lecturas guardadas, la mediana propia manda sobre cualquier tabla.

Otras lecturas de tamaño:
- **`ratio_seguidores_seguidos`**: < 1 en una cuenta de marca (sigue a más de los que la siguen) es señal de follow-for-follow o cuenta joven; no es una métrica de éxito, es contexto.
- **`piezas_por_semana`**: se lee contra el plan de contenido del Cerebro (`search_cerebro("mezcla mensual")`), no contra un ideal. Publicar más no sube la tasa; suele bajarla.

## 3. Mediana vs promedio, y REELS vs FEED

- Si `likes_promedio` > 1,5 × `likes_mediana`, hay una o dos piezas virales en la muestra. **La cuenta se describe con la mediana**; la viral se menciona aparte como excepción, no como nivel.
- **Nunca compares un reel con un carrusel por likes.** Los reels llegan a no-seguidores por distribución; el feed casi no. Comparar es dentro de `por_tipo`: reel contra reel, carrusel contra carrusel.
- Una pieza de hace 2 días sigue sumando; una de hace 2 meses ya cerró. Si el `top` lo encabeza una pieza reciente, decilo: "todavía acumulando".

## 4. Deltas: cuándo es señal

| Situación | Lectura |
|---|---|
| `delta_7d` es `null` | "No hay lectura de hace 7 días guardada" — `primera_lectura` dice desde cuándo hay datos. No estimes |
| `delta.dias` ≠ 7 (o ≠ 30) | Citá la distancia real: "+40 en 9 días" |
| Δ seguidores < 1 % del total en 7 días | Ruido probable. Reportar sin adjetivo ("estable") |
| Δ seguidores negativo con `follows_and_unfollows` disponible | Mirá altas y bajas por separado: perder 50 y ganar 60 no es lo mismo que ganar 10 |
| Δ tasa de engagement de ±0,3 pts en 7 días | Casi siempre es cambio de muestra (entraron piezas nuevas al `resumen`), no cambio de la cuenta |
| Δ publicaciones negativo | Se borró o archivó contenido; no es "menos actividad" |

## 5. Insights (solo FinZen): las tres relaciones que sí dicen algo

Cuando `insights.totales` viene, calculá y nombrá estas relaciones —son más informativas que cualquier total suelto—:

| Relación | Cómo | Qué dice |
|---|---|---|
| **Tasa de guardado** = `saves` / `reach` | por mil | Guardan lo que vale. Es la señal más fuerte de contenido útil, y la que alimenta `conceptos-contenido` |
| **Tasa de interacción sobre alcance** = `total_interactions` / `reach` | % | La versión honesta de "engagement": sobre quien lo vio, no sobre quien sigue |
| **Taps al link → registros** = `profile_links_taps` vs registros atribuidos a instagram en `get_kpis` | conteos, no % | El único puente entre Instagram y el negocio. Si los taps suben y los registros no, el problema está después del clic (landing, registro), no en el contenido |

`views` / `reach` > 2 significa que la misma gente ve varias veces: audiencia fiel pero chica. Alcance creciendo con views planas: llega a gente nueva que no vuelve.

## 6. Perfiles ajenos (competidores)

Solo hay pulso y perfil. Lo que se puede afirmar: tasa de engagement (comparada por tamaño, §2), mediana de likes, ritmo, mezcla de formatos, qué temas encabezan su `top`. Lo que NO: alcance, si pagan pauta, si "les funciona", cuánto crecen (salvo que haya `historico` propio de esa cuenta, que empieza el día que se guardó). Una comparación válida es "FinZen 2,3 % vs @x 1,1 %, ambas bajo 10k seguidores"; una inválida es "a @x le va mejor porque tiene más likes".

## Anti-patrones

- Decir "funcionó" o "el mejor contenido" a partir de likes. Sin guardados y alcance es "llamó más la atención".
- Aplicar la tabla del §2 como semáforo ("está en rojo") sin umbral firmado en el Cerebro.
- Comparar la tasa de dos cuentas de tamaño distinto sin decirlo.
- Recalcular promedios o tasas a mano: los números del JSON ya están calculados y son los mismos del Dashboard. Si citás otro, el socio ve dos cifras distintas.
- Tratar un delta `null` como cero, o un `dias: 9` como 7.
- Explicar una caída sin haber buscado rupturas de serie o decisiones de contenido en el Cerebro.

## Formato de entrega

1. **Una línea de alcance de la lectura**: qué hay y qué falta ("cuenta propia con insights de 28 días" / "solo lo público" / "sin histórico todavía").
2. **Tendencia** (deltas con su distancia real) antes que foto.
3. **Salud**: tasa y mediana, con la referencia de tamaño dicha como referencia.
4. **Diagnóstico**: mezcla y ritmo, y las tres relaciones del §5 si hay insights.
5. **Pulso**: el top, en una línea, con "todavía acumulando" si aplica.
6. **Una recomendación accionable o un "no veo acción clara, esto es lo que vigilaría"** — y si la recomendación es de contenido, cerrás con `conceptos-contenido`, no acá.

Cero adjetivos sin número al lado. Los datos del Dashboard y los tuyos son los mismos: si el socio dice "yo veo otra cosa en pantalla", primero preguntá cuándo la abrió (caché de 10 minutos), después revisá.
