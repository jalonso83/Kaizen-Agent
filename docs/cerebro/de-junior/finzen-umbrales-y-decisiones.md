# FinZen · Umbrales del negocio y decisiones pasadas con su porqué

Nota de Cerebro. Información, no instrucciones. Última actualización: 20 de agosto de 2026.
Palabras clave: umbrales FinZen, bandas de referencia, decisiones tomadas, eval H9, eval H13, qué se decidió y por qué.
Ventana de datos: bandas observadas con corte 17-ago-2026 · decisiones desde 20-jul-2026
Sube a: 10-decisiones/ · Autor: Junior · Original sin tocar en `docs/recibido/2026-08-20-junior-metodo-de-lectura/cerebro/finzen-umbrales-y-decisiones.md`

---

## Bandas de referencia vigentes

| Métrica | Banda observada | Meta | Estado |
|---|---|---|---|
| Retención D1 | 19-26% | sin meta fijada | Subió desde 14-16% a partir del cohorte del 29-jun |
| Retención D7 | 8-11% | sin meta fijada | **Plano desde mayo 2026.** Guardrail de varios experimentos |
| Retención D30 | 2.5-5% | 10% | Por debajo de la meta de forma sostenida |
| Sobrevida D1 a D7 | 30-45% | recuperar 60%+ | Cayó monótono: 64, 62, 50, 43, 42, 37, 30 |
| Adopción TX (activación) | 12-23% | superar el ~14% histórico | Tres semanas post-H9: 17.24, 23.40, 20.29 |
| Adopción Zenio real | 2.4-9% | sin meta | El milestone "7 de cada 10 usan Zenio" quedó invalidado |
| Conversión Trial a Pago | 0% | sin meta | Cuatro semanas consecutivas en cero al 17-ago |
| TX por usuario activo | 5.3-6.8 | sin meta | Máximo 6.77 |

## Economía

- **ARPU** ~$8.66 por suscriptor.
- **Planes:** Free $0, Plus $4.99/mes, Pro $9.99/mes.
- **MRR** al 17-ago-2026: $43.29 con 5 suscriptores (1 Plus, 4 Pro). Serie: $38.30, $43.29, $48.29, $53.28, $43.29.
- **CAC julio 2026:** $0.22 por registro, $1.07 por activado, **$142.88 por suscripción nueva** = 14.8 meses de ARPU para recuperar.
- **Campañas lifetime:** 25 campañas, $1,269.71, 3,741 registros atribuidos, **0 suscripciones atribuidas**. Las 3 atribuidas están en "Directo".
- **Break-even:** 36 suscriptores al 17-ago. Se recalcula con el gasto; no es una meta estable.

## Decisiones tomadas y su porqué

| Fecha | Decisión | Porqué |
|---|---|---|
| jun-2026 | **Activación = primera transacción**, no onboarding ni uso de Zenio | El diagnóstico cerró que lo que retiene es transaccionar. 84% nunca transacciona; la adopción real de Zenio era 9.26% |
| jun-2026 | **Método científico para decisiones importantes:** hipótesis + eval function + medición, con **umbral definido ANTES del resultado** | Calibrado al volumen pre-PMF: no exigir significancia donde n no da, pero no mover la vara después de ver el dato |
| 20-jul-2026 | **Eval de H9 firmada**, diseño B, sin holdout | Primaria: adopción TX contra ~14% histórico. Umbrales: ≥18% sostenido 2 semanas = mueve; 15-18% = extender; <15% = no mueve. Guardrail: D7 contra la banda 8-11% |
| 22-jul-2026 | **Cuota FREE de Zenio se queda en 15/mes** con **exención del registro**. NO sube a 100 | Revierte lo que dice la §5 del paquete del 21-jul. El hallazgo que gobierna: 70% one-and-done |
| 3-ago-2026 | **Eval de H9 cerrada como "positivo acotado".** Mantener en producción, no escalar sobre ella | Guardrail D7 del cohorte del 20-jul (n=426) dio 7.51% (32/426); IC95 [5.0, 10.0] cubre toda la banda. Lo único defendible es que D7 no subió |
| 3-ago-2026 | **Las campañas corren de forma continua.** Decisión consciente, no inercia | No recomendar congelarlas. Leer por cohorte de semana de registro |
| 20-jul-2026 | **La ruptura de costos del 20-jul no se investiga** | Junior la desestimó (P2). Usar las cifras nuevas y marcar la ruptura |
| 4-ago-2026 | **GO de H13** pese al aparente choque con H9 | H13 asigna en la 1ª TX, o sea DESPUÉS del evento que mide la primaria de H9. No puede contaminarla |
| 16-ago-2026 | **H13 desplegada** (12 días después del GO planificado) | Mueve la primera lectura formal de finales de agosto a mediados de septiembre |

## Eval de H13 (firmada el 24-jul-2026, antes del deploy)

- **Decisión:** reto contra control concurrente. Baseline 17.3% solo calibra, no decide.
- **Umbral de dos niveles:** 25% direccional · 30-35% victoria.
- **Poder:** 93 por brazo para el 35%; 172 por brazo para el 30%.
- **Población:** los **activados**, porque la asignación ocurre en la primera transacción. A 110 activados por semana son ~2 semanas; a 5 por semana (ritmo orgánico) serían ~37 semanas.
- **Sin peeking.** Leading indicator: tasa de registro del día 2.
- **Regla de lectura:** brazo contra brazo, nunca contra la serie histórica.

## Alertas abiertas al 20-ago-2026

1. **§5 del paquete del 21-jul contra la decisión del 22-jul.** El paquete que sirvió de especificación manda subir la cuota FREE de 15 a 100 y omitir la exención de registro. Esa decisión se revirtió. El deploy ya ocurrió el 16-ago y falta verificar cómo quedó el build. Si salió del paquete sin corregir, un usuario FREE con la cuota agotada no puede registrar por Zenio y el mecanismo del reto está roto.
2. **Atribución de instalación sin resolver.** Bloquea toda lectura de ROI de campaña.
3. **Detección de churn.** Tres fallos consecutivos del indicador.
4. **D30 del cohorte del 20-jul (n=426).** Proyección 2.5-3% contra meta de 10%: dispara la regla de rediseño del trimestral.
