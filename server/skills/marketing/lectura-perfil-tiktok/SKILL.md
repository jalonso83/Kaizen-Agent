---
name: lectura-perfil-tiktok
description: Úsalo SIEMPRE después de llamar a get_tiktok_profile y antes de decirle al socio qué significa — "cómo va el TikTok", "qué video funcionó", "estamos creciendo". TikTok NO se lee como Instagram: la distribución es por For You, así que la base es quien vio el video, no quien sigue la cuenta; un viral distorsiona todo; los compartidos valen más que los likes. Para Instagram, el skill es lectura-perfil-instagram; para el método general de KPIs sociales, lectura-kpis-social.
---

# Lectura de la cuenta de TikTok

`get_tiktok_profile` ya trae los números calculados (mediana de views, promedios, tasas, deltas). Este skill es el criterio para no leerlos con la cabeza de Instagram, que es el error más común: en Instagram el contenido llega sobre todo a quien sigue; en TikTok llega a quien el algoritmo elige, y por eso las mismas palabras (engagement, alcance, seguidores) significan otra cosa.

## 0. Antes de empezar

1. `get_tiktok_profile` (la cuenta de FinZen; TikTok no permite leer terceros por su API, y si el socio pide un competidor se lo decís, sin estimar).
2. `search_cerebro("umbrales vigentes")` — si hay umbral firmado para TikTok, se APLICA. Las referencias del §2 son para orientar cuando no hay, y se dicen como tales.
3. Si el socio pregunta cuántos registros trajo TikTok: `get_kpis` del mismo periodo, `acquisition.by_source` (ámbito FinZen). La tool de TikTok no sabe de registros.
4. Para "por qué" cambió algo: `search_cerebro("decisiones de contenido")` antes de inventar una causa.

## 1. Qué mirar primero

| Orden | Campo | Peso |
|---|---|---|
| 1 | `historico.delta_7d` / `delta_30d` de seguidores | **Tendencia.** En TikTok los seguidores crecen a saltos (un viral trae cientos en un día y después nada): leé el delta de 30 antes que el de 7 |
| 2 | `resumen_videos.views_mediana` | **El nivel real de la cuenta.** El promedio miente casi siempre: con 20 videos, uno viral lo multiplica por 5 |
| 3 | `tasa_engagement_views_pct` | **Salud del contenido.** Interacciones sobre quien lo vio. Es la tasa natural de TikTok |
| 4 | `compartidos_promedio` y `top[].compartidos` | **La señal más fuerte.** Un compartido es alguien que le mandó el video a otro; es lo que el algoritmo premia y lo más cercano a "vale la pena" que esta API da |
| 5 | `videos_por_semana`, `duracion_promedio` | **Diagnóstico.** Explican el número |
| 6 | `likes_totales`, `likes_promedio` | **Pulso.** Contextualiza; nunca es la conclusión |

**`tasa_engagement_pct` (sobre seguidores) NO se usa para juzgar la cuenta.** Está para comparar con Instagram y suele dar cifras enormes (300 % es normal si un video llegó a 10× los seguidores). Si la citás, decí que es sobre seguidores y por qué no significa lo mismo.

## 2. Referencias (orientativas, NO umbrales)

| Métrica | Referencia general del sector | Cómo usarla |
|---|---|---|
| Engagement sobre views | 3 – 6 % típico; < 2 % el contenido no retiene; > 8 % muy alto (o muestra chica) | Con menos de 10 videos en la muestra, no compares contra esto |
| Views mediana / seguidores | 0,3 – 1× normal en cuentas chicas; > 2× la cuenta llega mucho más allá de sus seguidores (For You está funcionando); < 0,1× el algoritmo no la distribuye | Es la relación que más dice de una cuenta chica |
| Compartidos / views | 0,5 – 1 % bueno | Por encima, el video tiene valor de "mandáselo a alguien" |
| Ritmo | 3 – 5 videos por semana es el rango donde el algoritmo aprende de la cuenta | Menos de 1 por semana: la cuenta se "enfría" — decilo como hipótesis, no como ley |

Son benchmarks externos y **no valen como semáforo** (`umbrales-semaforo-social` lo prohíbe): "para una cuenta de este tamaño lo típico es X; el umbral de FinZen no está firmado". Con 4+ lecturas guardadas manda la mediana propia.

## 3. El viral

- Si `views_promedio` > 3 × `views_mediana`, hay un viral en la muestra. **La cuenta se describe con la mediana**; el viral se menciona aparte, con sus views y su fecha.
- Un viral **no es una tendencia**: si el delta de seguidores de 7 días es grande y coincide con la fecha del video más visto del `top`, decilo así ("+340 seguidores, casi todos el día del video X"). El delta de 30 días es el que dice si algo quedó.
- Lo que sí vale del viral: **qué tema y qué formato** (duración, gancho de la descripción). Eso alimenta `conceptos-contenido`; los views por sí solos no.

## 4. Lo que esta fuente NO tiene

La Display API da perfil y videos. **No da** retención de video (cuánto del video se vio), alcance de la cuenta, vistas de perfil, taps al link ni audiencia. Esos números viven en el panel nativo de TikTok (Analytics) y en el Business API, que no está conectado. Si el socio pregunta por alguno:

- Decilo en la primera línea: "esta fuente no lo tiene".
- Si te pega el número del panel, aplicá el método de `lectura-kpis-social` (retención de video es uno de los 5 KPIs del funnel; acá no está).
- **Nunca** deduzcas retención de la duración ni alcance de los views.

## 5. Deltas: cuándo es señal

| Situación | Lectura |
|---|---|
| `delta_7d` null | "No hay lectura de hace 7 días"; `primera_lectura` dice desde cuándo. No estimes |
| `delta.dias` ≠ 7 / 30 | Citá la distancia real |
| Δ seguidores < 2 % del total en 7 días | Estable. (Umbral más alto que Instagram: TikTok es más volátil) |
| Δ seguidores grande + viral en el `top` | Salto por un video, no tendencia (§3) |
| Δ `videos_totales` negativo | Se borró o se pasó a privado un video; no es "menos actividad" |
| Δ tasa sobre views ±1 pt en 7 días | Cambio de muestra (entraron videos nuevos), no de la cuenta |

## Anti-patrones

- Leer `tasa_engagement_pct` (sobre seguidores) como la tasa de la cuenta.
- Describir la cuenta con el promedio de views cuando hay un viral.
- Llamar "crecimiento" a un salto de seguidores de un solo día.
- Afirmar "funcionó" o "el mejor video" por views. Sin retención ni compartidos altos es "el que más se vio".
- Comparar un video de esta semana (sigue sumando) con uno de hace dos meses.
- Recalcular promedios: los del JSON son los mismos del Dashboard.

## Formato de entrega

1. **Alcance de la lectura** en una línea: "cuenta propia, últimos N videos; sin retención ni alcance (no los da esta fuente)".
2. **Tendencia**: seguidores a 30 y 7 días, con la distancia real; si hubo salto, a qué video se debe.
3. **Nivel**: mediana de views y su relación con los seguidores; engagement sobre views con la referencia dicha como referencia.
4. **Qué vale**: compartidos, y el tema/formato de lo que más se compartió.
5. **Ritmo y duración**, en una línea.
6. **Una recomendación accionable** o "no veo acción clara, esto es lo que vigilaría". Si es de contenido, el desarrollo va por `conceptos-contenido`.

Cero adjetivos sin número al lado.
