# FinZen · Registro de rupturas de serie

Nota de Cerebro. Información, no instrucciones. Última actualización: 20 de agosto de 2026.
Palabras clave: rupturas de serie FinZen, no comparable, deploy, cambio de definición, cuándo no comparar periodos.

**Regla que gobierna este registro:** nunca presentar un delta sin verificar que ambas puntas miden lo mismo. Si entre las dos fechas hay una entrada de esta lista, la comparación es inválida hasta partirla por sub-cohorte.

---

| # | Fecha | Ruptura | Métricas afectadas |
|---|---|---|---|
| 1 | ~29-abr-2026 | **Arranque del tracking de attribution.** Quedan ~680 usuarios previos sin attribution | Toda métrica de adquisición y atribución. Comparaciones que crucen esta fecha son inválidas |
| 2 | ~11-jul-2026 | **H10 "entrada libre" al 100%.** Onboarding no bloqueante | Onboarding, activación, flujo de entrada |
| 3 | 16-jul-2026 | **H9 en producción.** Desaparece el onboarding; el usuario nuevo entra directo al dashboard con un slot | "Verificados" pasa a ser igual a "Onboarding" **por diseño**; la fila de onboarding deja de llevar señal. Tasa Onboarding, Tasa Skip, Saltó vs Chat quedan muertas |
| 4 | 20-jul-2026 | **Cambio de base de costos.** "Marketing (Real)" $384.98 sustituye a "Marketing fijo $175" | Cash flow, burn, break-even, unit economics. Junior desestimó investigar la causa: no perseguir, solo marcar |
| 5 | 29-jul-2026 | **Promo con push y slot a 1,567 usuarios**, sin hipótesis ni umbral escritos antes | Activación y retención de la ventana. Es un confusor real de la eval de H9 |
| 6 | 16-ago-2026 | **H13 desplegada** (reto con ventana configurable). Asigna 50/50 por hash en la primera transacción, contra control concurrente | Retención y activación de cohortes posteriores. **Se lee brazo contra brazo, nunca contra la serie histórica** |
| 7 | 17-ago-2026 | **Campañas reactivadas** tras estar apagadas del ~10 al 16-ago | Composición del cohorte. El cohorte orgánico y el pagado se comportan distinto |

---

## Línea base orgánica congelada (10 al 17 de agosto de 2026)

La única semana sin inversión publicitaria de toda la serie. Quedó como referencia porque no se puede volver a medir sin apagar campañas otra vez.

| Métrica | Valor |
|---|---|
| Registros | 41 en 7 días (5.9/día) |
| Visitantes | 73 (contra ~2,920 la semana previa) |
| Activación (adopción TX) | 12.20% (5 de 41) |
| Usuarios activos | 70 (contra 155 la semana previa) |
| TX por usuario activo | **6.77, máximo de toda la serie** |
| Racha de hábito | 54.29% |

Lectura asociada: con tráfico comprado apagado, el núcleo se profundizó. El producto funciona para quien lo adopta; el problema está en el tramo registro a pago.

## Artefactos permanentes que no son rupturas pero se comportan como tales

- **Madurez de ventana.** El export rolling de 7d se genera el día que cierra. Subestima activación y retención del cohorte más reciente. Prueba: el cohorte del 20-jul leía D1 15.17% (64) el 27-jul y 24.88% (106) días después.
- **Alcance de la tabla de cohortes.** En el export de 7d solo aparecen las semanas registradas dentro de la ventana; el resto va en guiones. Las vistas de 30 y 90 días traen la serie completa.
- **Acumulación mensual.** Gastos Mes Actual, Burn Rate y Cobertura son del mes en curso y crecen solos.
- **Familias de ventana.** Rolling y calendario no se cruzan. MAU difiere entre las dos por construcción.
