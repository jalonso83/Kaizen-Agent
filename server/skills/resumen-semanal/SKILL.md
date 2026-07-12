---
name: resumen-semanal
description: El formato y los criterios del resumen semanal automático de crecimiento (corrida del cron de los lunes; también si un socio pide "el resumen de la semana").
---

# Resumen semanal de crecimiento

Un documento que un socio lee en 3 minutos un lunes por la mañana y sabe: cómo
vamos, qué funcionó, y qué hacer esta semana. Datos → lectura → acción. Nunca
un vertedero de números.

## 1. Datos (siempre en este orden, siempre de tools)

1. `get_kpis` de la semana que cerró (lunes a domingo).
2. `get_kpis` de la semana anterior — para comparar.
3. `get_campaign_results` del período — campañas medidas y su lift.
4. Si algo se sale de lo normal (caída/salto fuerte), `evaluate_segment` de los
   segmentos relacionados para dimensionar (ej. cayó retención → ¿creció
   `dormant`?).

## 2. Estructura del documento

```markdown
# Resumen semanal de crecimiento — {YYYY-MM-DD}
**Período:** {lunes} al {domingo} · Generado por Kaizen

## En una línea
La lectura de la semana en una frase honesta.

## Los números que importan (vs semana anterior)
3-5 movimientos RELEVANTES, cada uno: cifra actual, delta, y una línea de
lectura. No listar todos los KPIs — elegir los que cuentan la historia.

## Campañas
Por cada campaña medida: nombre, segmento, lift (o pre/post con su disclaimer)
y qué aprendimos. Si no hubo campañas: decirlo y qué oportunidad se perdió.

## Recomendaciones para esta semana (2-3)
Cada una: acción concreta + el dato que la respalda + impacto esperado.
Si una implica campaña: segmento con count real (evaluate_segment), mensaje
sugerido y medición — pero NO crearla (los socios la piden por chat si convence).

## Vigilar
1-2 señales a observar esta semana (métricas cerca de un umbral, experimentos
en ventana de medición).
```

## 3. Criterios de calidad

- **Honestidad primero**: si la semana fue mala, la primera línea lo dice. Un
  resumen que maquilla es peor que no tener resumen.
- **Deltas con contexto**: "MRR $1,480 (+3.2%)" y no "$1,480". Registros bajos
  en semana de asueto → decir el contexto, no gritar tendencia.
- **Ojo con muestras chicas**: cambios porcentuales grandes sobre números
  chicos (3→6 trials = "+100%") se reportan en absolutos.
- **Cada recomendación es accionable esta semana** — no "mejorar la retención"
  sino "campaña a los 95 dormidos FREE de 30+ días con gancho de racha".
- Convención de la API: los `*_pct` son puntos (31.0 = 31%).

## 4. Entrega

`save_content_draft` en la carpeta `assets`, título `Resumen semanal
{YYYY-MM-DD}` (fecha del lunes de generación). Formato Markdown con la
estructura de arriba.
