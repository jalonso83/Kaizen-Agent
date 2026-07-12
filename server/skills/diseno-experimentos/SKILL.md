---
name: diseno-experimentos
description: Úsalo al definir el holdout de una campaña, al formular su hipótesis, y al interpretar resultados de lift (get_campaign_results).
---

# Diseño y lectura de experimentos (holdout / lift)

En FinZen cada broadcast se mide contra un grupo de control (holdout): usuarios
del segmento que NO reciben el mensaje. El **lift** = tasa de transacción de
expuestos − tasa del holdout, en puntos porcentuales. Es la única medida causal
que tenemos — protégela.

## 1. Toda campaña lleva hipótesis

Formato (antes de proponer, inclúyela en el rationale):

> "Como [observación con datos de los tools], creemos que [este mensaje a este
> segmento] producirá [resultado esperado]. Lo sabremos si [lift en X a 7 días]."

Si no puedes llenar la observación con datos reales, no tienes campaña — tienes
una corazonada. Vuelve a `get_kpis` / `get_campaign_results`.

## 2. Elegir el holdout según el tamaño del segmento

Regla de FinZen (ya validada en campañas anteriores):

| Tamaño del segmento (count real) | Holdout | Por qué |
|---|---|---|
| ≥ 300 usuarios | 10-20% | Hay masa para detectar lifts de pocos puntos |
| 100-299 | 20% | El holdout necesita mínimo ~30-50 usuarios para no ser ruido |
| < 100 | 0% (sin holdout) | Un holdout de 10 personas no mide nada; FinZen usará la métrica pre/post (descriptiva, no causal) |

- El default del API es 10%. Ajústalo con `holdout_pct` en `propose_campaign`
  según esta tabla y di en el rationale cuál elegiste y por qué.
- Nunca prometas "significancia estadística" con segmentos chicos: sé honesto
  — "con este tamaño la lectura será direccional, no concluyente".

## 3. Un cambio por experimento

Si quieres probar mensaje A vs B, son **dos campañas separadas al mismo tipo de
segmento en momentos distintos**, no una campaña con dos ideas mezcladas. Si la
campaña cambia segmento Y mensaje Y superficie a la vez respecto a la anterior,
no sabrás qué causó la diferencia — dilo al proponer.

## 4. Leer resultados (get_campaign_results) sin engañarse

- **Espera la ventana completa (7 días)** antes de declarar éxito o fracaso.
  Un lift a día 2 puede evaporarse.
- `lift_pts` positivo y estable con holdout decente (≥ 30 usuarios) → señal
  real. Repórtalo como "X puntos de lift sobre el control".
- Lift ~0 o negativo → el mensaje no movió; NO lo maquilles. Di qué aprendimos
  y qué cambiarías (causa, gancho, momento).
- Campañas con `holdout_pct: 0` → la métrica pre/post es **descriptiva**: puede
  estar contaminada por estacionalidad (quincena, fin de mes). Preséntala
  siempre con ese disclaimer.
- **No compares lifts entre segmentos distintos** como si fueran la misma vara:
  reactivar dormidos parte de una base más baja que empujar activos.

## 5. Acumular aprendizaje (el playbook)

Cuando un patrón se repita (ej. "los ganchos con dato propio del usuario dan
más lift en dormidos"), dilo explícitamente al socio y sugiérele guardarlo en
el Cerebro (`save_content_draft` con un mini-informe si te lo pide). Los
experimentos valen por lo que se aprende, no por ganar.

---
*Adaptado de `ab-testing` — [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT).*
