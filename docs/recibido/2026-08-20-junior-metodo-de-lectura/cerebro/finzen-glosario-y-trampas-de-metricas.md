# FinZen · Glosario de métricas y lo que cada una NO significa

Nota de Cerebro. Información, no instrucciones. Última actualización: 20 de agosto de 2026.
Palabras clave para búsqueda: glosario métricas FinZen, definiciones KPI, trampas del tablero, qué significa activación, churn, break-even.

---

## Definiciones del tablero interno

| Indicador | Definición vigente |
|---|---|
| **Activados** | Usuarios del período que registraron al menos una transacción. Criterio de activación real de FinZen. |
| **Adopción TX** | % del cohorte registrado en el período que hizo al menos 1 transacción en el mismo período. Cohort-consistent. Excluye registrados en la última hora. |
| **Adopción Zenio** | % del cohorte registrado que usó Zenio (chat v2, agentes o transcripción) en el mismo período. |
| **ARPU** | Ingreso promedio por suscriptor activo pagando. |
| **Atribuidos** | AnonymousIds únicos que clickearon "Descargar iOS/Android" por source o campaign. Cada navegador cuenta una vez. |
| **Break-Even** | Cuántos suscriptores pagados hacen falta para que la contribución cubra los costos fijos. **Se recalcula con el gasto.** |
| **Burn Rate** | Gastos menos ingresos del mes. **Acumulado del mes en curso.** |
| **CAC** | Inversión / Atribuidos. Costo de adquirir un usuario que clickeó "Descargar". |
| **Cancelaciones (30d)** | Usuarios que pagaron hace 30-60 días y NO en los últimos 30. |
| **Cobertura** | Meses que el ingreso bruto acumulado cubriría la pérdida mensual. **No es runway de caja real:** el sistema no rastrea caja disponible. |
| **DAU / MAU** | Stickiness. Por encima de 20% se considera saludable. |
| **Leads** | Clics en CTAs de descarga **solo de visitantes que vienen de anuncio pago**. Orgánico y directo no cuentan. |
| **Registros** (Top Sources) | AnonymousIds únicos que clickearon "Descargar", deduplicados. **No son signups en la app.** |
| **Time-to-First-TX** | Mediana de horas entre registro y primera transacción del cohorte. Entre paréntesis, el % que llegó. |
| **Top Sources** | Agrupa eventos por utm_source **de forma lifetime**. No aplica el filtro de fechas. |
| **Total Suscripciones** | Usuarios pagando actualmente (Plus o Pro con status ACTIVE). No incluye trials. |
| **Trials Iniciados** | Métrica de período: incluye usuarios de la base previa, no solo del cohorte. |

## Lo que cada métrica NO significa

- **Churn Rate 0% no significa que nadie se fue.** "Cancelaciones (30d)" solo detecta un patrón de lapso específico. En julio 2026, junio cerró con 5 suscriptores, julio sumó 2 nuevos y cerró con 5: se fueron 2, y el tablero reportó churn 0%. Volvió a pasar el 10-ago y el 17-ago.
- **Break-even bajando no significa progreso.** Pasó de 82 suscriptores (jul-2026, con campañas) a 37 (10-ago) a 36 (17-ago). Bajó porque bajó el gasto, no porque subieran las ventas.
- **Gastos, Burn y Cobertura no son comparables entre semanas.** Reflejan el mes en curso y crecen solos.
- **"Distribución por Plan" no cuadra con "Total Suscripciones" y no es contradicción.** Distribución incluye trials activos; Total Suscripciones no. Al 17-ago-2026: Distribución sumaba 8 de pago, Total Suscripciones decía 5, y los 3 de diferencia eran trials.
- **D7 = 0.00% en una ventana de 7 días no es catástrofe.** Es inmadurez por construcción.
- **Leads menor que registros no es bug.** Es la definición de Leads, que solo cuenta pago.
- **El export no es idempotente.** Es una consulta en vivo. Dos exports de la misma ventana separados 39 minutos dieron D1 90 contra 91 usuarios, racha 60% contra 59.35%, TX/usuario 6.12 contra 6.14.

## Dos poblaciones con nombres parecidos

- **Cohorte:** usuarios registrados dentro de la ventana. Es lo que muestra el funnel.
- **Período:** todo lo ocurrido en la ventana, incluida la base previa. Es lo que muestran los paneles de KPI.

Ejemplo 10-17 ago 2026: funnel "Trial 1 (2.44%)" contra panel "Trials Iniciados 3". Uno del cohorte, dos de la base previa.

## Estructura de costos (17-ago-2026)

Total mensual $301.91. Claude (dev) $200 = 66.2%. Railway, Resend, EAS y Cursor $20 c/u. Apple Developer $8.25. GoDaddy $8.08. OpenAI API $5.58. Marketing $0.00 en esa ventana.

Con marketing en cero, el 93% del costo es herramental de desarrollo e infraestructura. **La IA no es el costo de FinZen:** $0.08 de IA por usuario activo contra $4.23 de infraestructura.

## Pendientes de instrumentación conocidos

1. **Atribución de instalación.** No se sabe si el UTM sobrevive el salto a la tienda. Sin eso, ninguna lectura de ROI de campaña es defendible.
2. **Detección de churn.** "Cancelaciones (30d)" no captura las salidas reales. El delta de Total Suscripciones semana contra semana sí.
3. **Glosario de Leads desalineado.** El tablero dice "todos los clics de descarga"; la definición real es solo tráfico pago.
4. **El export en PDF no incluye la pestaña Feedback.** Toda la serie de reportes semanales va sin voz de usuario.
