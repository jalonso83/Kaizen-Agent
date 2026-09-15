# FinZen · Catálogo de audiencias para campañas (Agent API / broadcasts)

Ventana de datos: 2026-09-15 (consulta directa a producción; los tamaños cambian a diario)
Sube a: `00-nucleo/` · Tipo: información de referencia, no instrucciones · Escrita: 2026-09-15 · Fuente: equipo FinZen (CATALOGO_AUDIENCIAS_2026-09-15.md)

Palabras clave: segmentos, audiencias, catálogo de segmentos, never_activated, one_and_done, dormant, active, trial_no_activity, trial_ending, trial_available, near_paywall, budget_exceeded, payment_failed, subscriber_inactive, push alcanzable, base alcanzable.

> Nota para Kaizen: esta es la descripción de negocio de cada audiencia y sus tamaños al 15-sep. **Qué segmentos existen de verdad en la Agent API lo dice `list_segments` en vivo**; si uno de esta lista no aparece ahí, todavía no está expuesto al agente. Los tamaños de abajo NO reemplazan a `evaluate_segment`: son una foto de un día.

---


**Fecha de los números (ver Ventana de datos arriba):** 15-sep-2026 (consulta directa a prod).
**Base alcanzable:** 4.557 usuarios registrados → **2.874 con dispositivo activo** (los únicos a los que llega un push). Todos los tamaños de abajo son sobre esos 2.874 y con todos los planes/plataformas/países.

Reparto de la base hoy: FREE 2.659 · PRO en trial 208 · pagando (Plus + Pro) 6.

Los segmentos se combinan con **OR** entre sí y con **AND** contra los filtros base (plan, plataforma, país, tipo de mensaje para opt-out).

---

## Activación

| Audiencia | Quién es exactamente | Hoy | Por qué vale la pena | Mensaje que le toca |
|---|---|---|---|---|
| **Nunca activó** `never_activated` | Registrado con **0 transacciones** de por vida. | **2.191** (76% de la base) | Es la fuga más grande del embudo. Cualquier punto que se mueva aquí pesa más que cualquier otro segmento. | "Registra tu primer gasto" — un solo paso, sin pedir nada más. |
| **Una y nunca más** `one_and_done` | **Exactamente 1** transacción y sin actividad hace **7+ días** (umbral configurable). | **202** | Probó la app y no vio el valor. No es "vuelve", es "haz la segunda": la segunda transacción es lo que convierte la prueba en hábito. | "Ya registraste uno. El segundo es donde empieza a verse el patrón." |
| **Dormidos** `dormant` | ≥1 transacción y sin actividad hace **N días** (7 / 14 / 30). | **578** a 14 días | Ya usaron la app; recuperar a un usuario que conoce el producto es más barato que activar uno nuevo. | Re-engagement: novedad, recordatorio de meta, "¿cómo va tu mes?". |
| **Activos** `active` | ≥1 transacción y actividad en los últimos N días. | **104** a 14 días | Los que están dentro. Para anuncios de producto y promos; no para "vuelve". | Novedades, funciones nuevas, promo de upgrade. |

## Trial

| Audiencia | Quién es exactamente | Hoy | Por qué vale la pena | Mensaje que le toca |
|---|---|---|---|---|
| **Trial sin usar lo Pro** `trial_no_activity` | En trial hace **3+ días** (configurable) y **no ha tocado nada exclusivo del plan pagado**: sin correo conectado, presupuestos y metas dentro del límite FREE, Zenio dentro del límite FREE. | **123** (de 208 en trial) | Es el único momento en que se puede rescatar la conversión. Cuando venza el trial cae a FREE **sin haber visto la diferencia**, y ya no hay razón para pagar. Reloj: 21 días desde el registro. | Empujar UNA función Pro concreta: "conecta tu correo y deja de teclear gastos" o "Zenio sin límite". |
| **Trial por vencer** `trial_ending` | Trial que vence en los próximos **3 días** (configurable). | **0** — se empieza a llenar ~21-sep, cuando venzan los primeros trials del 31-ago | Última llamada. Es el mensaje con mejor timing de todo el catálogo. | "Te quedan 3 días de Pro. Esto es lo que pierdes." |
| **Prueba sin usar** `trial_available` | FREE registrado **antes del trial automático** (31-ago) que nunca activó su prueba. Sigue existiendo el botón en Suscripciones. | **2.575** | Base vieja que nunca vio el plan pagado. No pedimos tarjeta, así que el mensaje puede prometerlo sin mentir. Ojo: la mayoría también es "nunca activó" — no mandarles upgrade antes de que registren algo. | "Activa tu prueba gratis, sin tarjeta." Mejor cruzado con Activos o Dormidos, no con Nunca activó. |

## Conversión

| Audiencia | Quién es exactamente | Hoy | Por qué vale la pena | Mensaje que le toca |
|---|---|---|---|---|
| **Cerca del límite FREE** `near_paywall` | FREE con **presupuestos activos a 1 del tope** (3 de 4) o **metas al tope** (2 de 2). Zenio no se usa como criterio: casi nadie llega a 15/mes. | **648** | Están usando el producto lo suficiente como para chocar con el muro. Es el momento natural de pagar: el paywall se lo van a encontrar solos. | "Ya vas por 3 presupuestos. Con Plus tienes 10." |
| **Presupuesto excedido** `budget_exceeded` *(solo Agent API)* | ≥1 presupuesto vigente con gasto > monto. | **9** | Momento de dolor real; el mensaje llega cuando importa. Poco volumen. | Alerta útil + Zenio para entender en qué se fue. |

## Pago

| Audiencia | Quién es exactamente | Hoy | Por qué vale la pena | Mensaje que le toca |
|---|---|---|---|---|
| **Pago rechazado** `payment_failed` | Plus/Pro con el cobro **en reintento** (`PAST_DUE`). Todavía tiene acceso; si no se recupera, el proveedor lo da de baja. | **0** | Recuperar un pago vale más que cualquier campaña de adquisición. Hoy es 0 con 6 pagando, pero cuando pase es urgente y hay que tener el segmento listo. | "Tu pago no pasó. Actualiza la tarjeta para no perder el acceso." |
| **Pagan y no usan** `subscriber_inactive` | Plus/Pro **activo** sin actividad hace N días (mismo selector que Dormidos). | **1** | Churn anticipado: alguien que paga y no entra va a cancelar. Es el único aviso previo que existe. | Recordarle lo que tiene y no está usando. |

---

## Qué mirar primero (por volumen × urgencia)

1. **Trial sin usar lo Pro** (123, con reloj) — mueve conversión directa.
2. **Una y nunca más** (202) — mueve activación con un mensaje concreto.
3. **Cerca del límite FREE** (648) — conversión de la base vieja.
4. **Trial por vencer** — preparar la campaña ahora; en una semana tiene gente.
5. **Nunca activó** (2.191) — el volumen está aquí, pero es la audiencia más fría; probar mensajes y medir con holdout.

## Notas de lectura

- Los conteos son **push alcanzable** (dispositivo activo), no usuarios totales. El 37% de los registrados no tiene dispositivo activo y no recibe nada.
- Un usuario puede estar en varios segmentos a la vez (p. ej. "Nunca activó" y "Prueba sin usar"). Al combinar con OR no se duplica el envío.
- Los umbrales de "Una y nunca más" (7 días) y "Trial sin usar lo Pro" (3 días) no tienen selector en el panel; van por defecto. El agente sí puede pasarlos como parámetro.
- Los límites FREE que usan "Cerca del límite" y "Trial sin usar lo Pro" salen de `config/stripe.ts` (4 presupuestos, 2 metas, 15 Zenio); si cambia el plan, los segmentos se ajustan solos.

Código: `FinzenAI-backend-temp/src/services/broadcastService.ts` (SQL), `src/config/agentSegments.ts` (catálogo del agente), `FinzenAI-landingPages/app/dashboard/broadcasts/page.tsx` (panel).
