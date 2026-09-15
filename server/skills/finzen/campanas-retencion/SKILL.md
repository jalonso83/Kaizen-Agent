---
name: campanas-retencion
description: Úsalo cuando el socio pida reactivar, retener, convertir o recuperar usuarios (nunca activados, una y nunca más, dormidos, trial sin usar lo Pro, trial por vencer, cerca del límite FREE, presupuesto excedido, pago rechazado, pagan y no usan) o pregunte "qué campaña hacemos".
---

# Campañas de retención y reactivación

La retención es la palanca de ingresos más barata: recuperar un usuario dormido
cuesta una fracción de adquirir uno nuevo. Este es el método.

## 1. Diagnóstico antes de proponer (siempre en este orden)

1. `get_kpis` — mira retención D1/D7/D30, churn y MRR del período. ¿El problema
   es que no vuelven (engagement) o que se van del pago (churn)?
2. `list_segments` + `evaluate_segment` — dimensiona los segmentos candidatos
   con counts reales. **El catálogo lo dice `list_segments`, no tu memoria ni
   esta tabla**: FinZen lo amplió el 2026-09-15 y puede volver a hacerlo. Si un
   slug de la tabla de abajo no aparece en la respuesta, ese segmento no existe
   todavía en la Agent API — dilo, no lo uses. Compara tamaños: un segmento de
   40 usuarios no mueve el negocio aunque el mensaje sea perfecto. Los counts
   son **push alcanzable** (con dispositivo activo), no usuarios totales.
3. `get_campaign_results` — ¿qué se intentó antes con este segmento y qué lift
   dio? No repitas un mensaje que ya demostró no funcionar. Ojo: ahí solo están
   las campañas **ya enviadas**, con `sent_at` como fecha real de publicación.
   Un borrador tuyo en PENDING_APPROVAL todavía no salió y no cuenta como
   intento — al citar antecedentes, di de cada uno si se publicó y cuándo.

## 2. Empareja la intervención con la CAUSA, no con el segmento

La regla de oro (heredada de los cancel flows): una oferta genérica para todas
las causas no funciona. Cada segmento de FinZen sugiere una causa distinta:

| Segmento | Causa probable | Intervención que funciona |
|---|---|---|
| `never_activated` | No vio el valor inicial; fricción de arranque | Guiar a la PRIMERA acción de valor. Nada de features avanzadas. Tres ángulos válidos, rotá entre ellos (no uses siempre el mismo): (a) registrar su primer gasto, (b) preguntarle algo suelto a Zenio, (c) ver su primer mini-análisis/resumen de gastos. |
| `dormant` (con historial) | Perdió el hábito; la app dejó de ser top-of-mind | Recordar el valor que YA obtuvo ("llevabas X registrado") + una acción de 10 segundos. |
| `budget_exceeded` | Momento de dolor financiero AHORA | Ayuda inmediata y empática, no venta: Zenio te ayuda a reajustar. Es el momento de mayor relevancia. |
| `trial_ending` | Riesgo de perder acceso sin haber decidido | Recordar el beneficio concreto usado en el trial + qué pierde. Urgencia honesta (fecha real), jamás falsa. |
| `active` | Nada que arreglar | NO bombardear. Solo anuncios de valor real (feature nueva, contenido). Sobre-mensajear activos genera opt-outs. |
| `one_and_done` (1 transacción, 7+ días) | Probó y no vio el valor. **No es "vuelve", es "haz la segunda"**: la segunda transacción es la que convierte la prueba en hábito | "Ya registraste uno; el segundo es donde empieza a verse el patrón." Una acción concreta, no un tour. |
| `trial_no_activity` (en trial 3+ días sin tocar nada Pro) | Va a caer a FREE **sin haber visto la diferencia**, y ya no habrá razón para pagar. Reloj: 21 días desde el registro | Empujar UNA función Pro concreta ("conecta tu correo y deja de teclear gastos", "Zenio sin límite"). Es el único momento en que la conversión se rescata. |
| `near_paywall` (FREE a 1 del tope de presupuestos o metas al tope) | Usa el producto lo suficiente como para chocar con el muro: momento natural de pagar | "Ya vas por 3 presupuestos; con Plus tienes 10." Valor primero; el paywall se lo va a encontrar solo. |
| `payment_failed` (cobro en reintento) | Va a perder el acceso sin haberlo decidido | "Tu pago no pasó; actualiza la tarjeta para no perder el acceso." Recuperar un pago vale más que cualquier campaña de adquisición; hoy es 0, pero cuando pase es urgente. |
| `subscriber_inactive` (paga y no entra) | Churn anticipado: el único aviso previo que existe | Recordarle lo que tiene y no está usando. Nunca "¿sigues ahí?". |
| `trial_available` (FREE anterior al trial automático) | Nunca vio el plan pagado | "Activa tu prueba gratis, sin tarjeta" — es verdad, no se pide tarjeta. **Cruzado con activos o dormidos, no con nunca activados**: a quien no registró nada no se le vende upgrade. |

Orden sugerido por volumen × urgencia (catálogo del 2026-09-15): trial sin usar
lo Pro (con reloj) → una y nunca más → cerca del límite → trial por vencer
(preparar ahora: se llena ~21-sep) → nunca activó (el volumen está ahí, pero es
la audiencia más fría: probar mensajes con holdout). Un usuario puede estar en
varios segmentos a la vez; al combinar con OR no se duplica el envío.

## 3. Anti-patrones (no proponer nunca)

- **Mensajes genéricos** "te extrañamos" sin razón concreta para volver.
- **Sobre-frecuencia**: si el segmento recibió una campaña hace < 7 días,
  dilo y sugiere esperar o cambiar de segmento.
- **Descuentos como primera respuesta**: entrenan al usuario a esperar
  descuentos. Primero valor; incentivo solo si hay evidencia de que el valor
  solo no funcionó.
- **Culpar al usuario** ("no has vuelto", "abandonaste tu presupuesto") — el
  tono es de aliado, nunca de reproche.
- **Vender upgrade a quien no activó**: `trial_available` y `near_paywall` son
  para quien ya usa la app. A `never_activated` se le pide el primer gasto,
  nada más.
- **Repetir el mismo título/mensaje** que ya le propusiste a este segmento
  antes en esta conversación (rechazado o no). Si volvés a proponerle algo,
  cambia de ángulo de los de la tabla de arriba — no repitas la fórmula
  anterior con sinónimos.

## 4. Estructura de toda propuesta de retención

Segmento + count real → causa que atacas → mensaje (usa el skill `copy-push`
y el tono del Cerebro) → qué se medirá (lift vs holdout — usa el skill
`diseno-experimentos` para el holdout correcto según el tamaño).

## 5. Qué es "funcionó"

- Lift positivo en tasa de transacción vs holdout a 7 días es la señal
  principal (viene en `get_campaign_results`).
- Un lift de 3-6 puntos en reactivación es bueno; > 6 excelente.
- Si dos campañas al mismo segmento dieron lift ~0: el problema no es el
  mensaje, es la oferta o el segmento — dilo al socio en vez de proponer una
  tercera variante del mismo mensaje.

---
*Adaptado de `churn-prevention` — [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT).*
