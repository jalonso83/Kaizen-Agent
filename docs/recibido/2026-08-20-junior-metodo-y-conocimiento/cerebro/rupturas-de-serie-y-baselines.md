# Rupturas de serie y líneas base congeladas

Actualizado: 2026-08-20 · Fuente: registro de cadencia de reportes (Junior + Claude) · Tipo: información de referencia
Regla asociada (vive en el skill lectura-kpis): no comparar a través de una ruptura sin partir la serie o marcar "no comparable".

## Rupturas registradas (orden cronológico)

| Fecha | Ruptura | Consecuencia al comparar |
|---|---|---|
| ~29-abr-2026 | Arranque del tracking; ~680 usuarios pre-tracking sin attribution | Comparaciones que crucen el 29-abr son inválidas |
| ~11-jul-2026 | H10 (entrada libre) al 100% | Onboarding/activación/entrada: partir por sub-cohorte |
| 16-jul-2026 | H9 desplegado (slot siempre encendido; ya no existe onboarding) | Métricas "por camino" del onboarding quedaron muertas; no leerlas |
| 20-jul-2026 | Cambio de base de costos ("Marketing (Real)" $384.98 vs $175 fijo) | Usar cifras nuevas; marcar la ruptura al comparar cash flow. Causa desestimada por Junior (no investigar) |
| 29-jul-2026 | Promo "7 días Premium sin tarjeta" a 1,567 usuarios (push+slot, holdout 10%) | Confusor de cualquier métrica de activación en esa ventana |
| 16-ago-2026 | H13 desplegada | H13 se lee brazo contra brazo concurrente, nunca contra serie histórica |
| 10→17-ago-2026 | Campañas apagadas ~10-ago, reactivadas 17-ago | La ventana 10-17 ago es la única semana orgánica pura de la serie; cruzar el 17-ago mezcla poblaciones |
| 7-ago-2026 (social) | Colapso de distribución IG (−98% alcance, 10+ días) | Semana social 10-16 ago excluida de calibraciones; en diagnóstico |

## Líneas base congeladas (para no recalcular)

- **Base orgánica pura (semana 10-16 ago, campañas apagadas):** 5.9 registros/día · activación 12.20% · 70 usuarios activos · 6.77 TX por activo (máximo de la serie) · 41 registros.
- **Referencias D7 históricas:** 8% (08-jun) · 8.98% (13-jul) · 9% (20-abr) · 10% (27-abr). Cohorte 20-jul (post-H9, n=426): 7.51% (32/426).
- **Decadencia D7→D30:** 33-40% (20-abr: 9%→3% · 27-abr: 10%→4% · 08-jun: 8%→5% · 15-jun: 11%→3%).
- **Social, semanas limpias del baseline (cortes 27-jul / 3-ago / 10-ago):** alcance IG 57.4k / 76.5k / 59.6k · seguidores netos +39 / +34 / +46 · moneda social cuenta 0.138% / 0.175% / 0.205% · TikTok views 275 → 508 → 846 → 1,066 (única serie con tendencia ascendente sostenida).

## Anomalías de datos abiertas (no confiar sin resolver)

- Cohorte 29-jun con dos cifras: 22% (21/95) en el mensual del 1-ago vs 16% (6/37) en la tabla del 3-ago. Pendiente aclaración de Alonso; afecta la confianza en la tabla de cohortes.
- Churn Rate imprime 0% mientras se pierden pagadores (no captura churn involuntario por pago fallido). Leer Revenue por Plan y Pagos Fallidos, no el flag.
- "Trials Iniciados" (periodo, incluye base previa) no cuadra con el embudo de trial por cohorte; son familias distintas.
