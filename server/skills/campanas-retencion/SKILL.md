---
name: campanas-retencion
description: Úsalo cuando el socio pida reactivar, retener o recuperar usuarios (dormidos, nunca activados, presupuesto excedido, trial por vencer) o pregunte "qué campaña hacemos".
---

# Campañas de retención y reactivación

La retención es la palanca de ingresos más barata: recuperar un usuario dormido
cuesta una fracción de adquirir uno nuevo. Este es el método.

## 1. Diagnóstico antes de proponer (siempre en este orden)

1. `get_kpis` — mira retención D1/D7/D30, churn y MRR del período. ¿El problema
   es que no vuelven (engagement) o que se van del pago (churn)?
2. `list_segments` + `evaluate_segment` — dimensiona los segmentos candidatos
   con counts reales. Compara tamaños: un segmento de 40 usuarios no mueve el
   negocio aunque el mensaje sea perfecto.
3. `get_campaign_results` — ¿qué se intentó antes con este segmento y qué lift
   dio? No repitas un mensaje que ya demostró no funcionar.

## 2. Empareja la intervención con la CAUSA, no con el segmento

La regla de oro (heredada de los cancel flows): una oferta genérica para todas
las causas no funciona. Cada segmento de FinZen sugiere una causa distinta:

| Segmento | Causa probable | Intervención que funciona |
|---|---|---|
| `never_activated` | No vio el valor inicial; fricción de arranque | Guiar a la PRIMERA acción de valor (registrar el primer gasto / hablar con Zenio). Nada de features avanzadas. |
| `dormant` (con historial) | Perdió el hábito; la app dejó de ser top-of-mind | Recordar el valor que YA obtuvo ("llevabas X registrado") + una acción de 10 segundos. |
| `budget_exceeded` | Momento de dolor financiero AHORA | Ayuda inmediata y empática, no venta: Zenio te ayuda a reajustar. Es el momento de mayor relevancia. |
| `trial_ending` | Riesgo de perder acceso sin haber decidido | Recordar el beneficio concreto usado en el trial + qué pierde. Urgencia honesta (fecha real), jamás falsa. |
| `active` | Nada que arreglar | NO bombardear. Solo anuncios de valor real (feature nueva, contenido). Sobre-mensajear activos genera opt-outs. |

## 3. Anti-patrones (no proponer nunca)

- **Mensajes genéricos** "te extrañamos" sin razón concreta para volver.
- **Sobre-frecuencia**: si el segmento recibió una campaña hace < 7 días,
  dilo y sugiere esperar o cambiar de segmento.
- **Descuentos como primera respuesta**: entrenan al usuario a esperar
  descuentos. Primero valor; incentivo solo si hay evidencia de que el valor
  solo no funcionó.
- **Culpar al usuario** ("no has vuelto", "abandonaste tu presupuesto") — el
  tono es de aliado, nunca de reproche.

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
