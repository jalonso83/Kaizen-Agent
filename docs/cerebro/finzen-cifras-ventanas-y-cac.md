# FinZen · Qué ventana cubre cada cifra (y por qué dos CAC correctos no coinciden)

Ventana de datos: abril–agosto 2026 (nota de reconciliación; cada cifra de abajo trae la suya)
Sube a: `10-decisiones/` · Tipo: información de referencia, no instrucciones · Escrita: 2026-09-03

Palabras clave: CAC FinZen, costo de adquisición, usuarios de pago, MRR, ventana
de datos, discrepancia de cifras, Diagnóstico de Activación, notas de Junior.

---

## Para qué existe esta nota

En el Cerebro conviven dos análisis del mismo negocio hechos con **tres semanas
de diferencia y denominadores distintos**. Dan números distintos para lo que
parece la misma pregunta. Los dos son correctos en su ventana.

Sin esta nota, una búsqueda por "CAC" devuelve el que gane el ranking y la
respuesta suena igual de segura en ambos casos, sin que nadie sepa cuál se usó.

**La regla:** ninguna de las dos cifras es "el CAC de FinZen". Cada una responde
una pregunta distinta. Al citar cualquiera, decir **de qué documento sale, de
qué ventana, y sobre qué denominador**.

## Las dos fuentes

| | Diagnóstico de Activación | Notas de Junior |
|---|---|---|
| Fecha | 25-jul-2026 | 17-ago-2026 (entregadas el 20-ago) |
| Dónde | `Contenidos/Documento maestro_Instrucciones_IA/Métricas/` (PDF) | `10-decisiones/`, `00-nucleo/` (md) |
| Ventana de sus cifras | acumulado **abr–jul 2026** | **julio 2026** (CAC) y **lifetime** (campañas) |
| Denominador | usuarios que pagan **vivos** (stock) | suscripciones **nuevas** del mes (flujo) |

## La reconciliación, número por número

### Costo de adquisición — $79 contra $142.88

Los dos salen de dividir, pero no dividen lo mismo:

- **$79** = $552 invertidos en abr–jul ÷ 7 clientes que pagaban. Verificado:
  552 / 7 = $78.86. Es un **promedio histórico acumulado**.
- **$142.88** = gasto de julio ÷ suscripciones **nuevas** de julio. Es el
  **costo marginal** de conseguir una suscripción más, hoy.

**Cuál usar:** para decidir si conviene gastar un dólar más, manda el marginal
($142.88), y su lectura es que recuperarlo toma **14.8 meses de ARPU**. El
acumulado ($79) sirve para narrativa histórica ("hasta julio llevábamos gastados
$552"), nunca para proyectar.

Junior da el CAC en **tres niveles** de la misma ventana (julio): **$0.22 por
registro · $1.07 por activado · $142.88 por suscripción**. El contraste entre el
primero y el tercero es el hallazgo, no un error de tipeo: el dinero entra
barato al embudo y se pierde adentro.

*Chequeo de consistencia interna (hecho al escribir esta nota):* $0.22 → $1.07
implica una activación de 0.22/1.07 = **20.6%**, que cae dentro de la banda de
adopción TX 12–23% que el propio Junior reporta. Y $1.07 → $142.88 implica
**~1 suscripción por cada 133 activados**, coherente con sus cuatro semanas
consecutivas de conversión trial→pago en 0%. Los tres niveles concuerdan entre
sí.

### Campañas lifetime — la cifra que no es CAC

**25 campañas, $1,269.71 invertidos, 3,741 registros atribuidos, CERO
suscripciones atribuidas.** Es **lifetime**, no abr–jul: por eso es mayor que
los $552 y no los contradice.

Las 3 suscripciones atribuidas figuran en "Directo". Junior deja abiertas las
dos lecturas: o el pago no convierte, o **el UTM muere en el salto a la tienda**
y lo convertido cae en "Directo". Sin resolver, y **bloquea toda lectura de ROI
de campaña** — incluido el cruce spend ↔ CAC de la Fase 2.

### Usuarios de pago — 7 contra 5

No es una discrepancia de medición: es **churn entre las dos fechas**, y está a
la vista en la propia serie de MRR de Junior:

```
$38.30 → $43.29 → $48.29 → $53.28 → $43.29
                                ↑ la caída
```

$53.28 − $43.29 = **$9.99 exactos: una suscripción Pro cancelada**. Al 17-ago
quedan 5 suscriptores (1 Plus, 4 Pro) sosteniendo $43.29 de MRR.

Engancha con una alerta abierta de Junior: **la detección de churn lleva tres
fallos consecutivos del indicador**. La cancelación se ve en el MRR, no en el
indicador que debería avisarla.

### Retención — 18.3%/6.7% contra bandas de 19-26%/8-11%

Las cifras del Diagnóstico quedan **apenas por debajo** de las bandas de Junior,
y eso es lo esperable: Junior documenta que D1 subió desde 14-16% recién a
partir del cohorte del 29-jun, y que D7 está **plano desde mayo**. Una medición
del 25-jul que promedia cohortes anteriores aterriza más abajo por construcción.
No hay conflicto.

Las dos fuentes, de forma independiente, llegan al mismo sitio en lo demás:
**D30 y churn en 0% son errores de medición**, no resultados.

## La grieta que SÍ queda abierta

El MRR de $43.29 **no cuadra con la mezcla de planes**: 1 Plus ($4.99) + 4 Pro
($9.99) = **$44.95**. Faltan **$1.66**.

Ojo con la trampa al revisarlo: **el ARPU no es evidencia independiente.**
$43.29 / 5 = $8.658, o sea que el ARPU de ~$8.66 está *derivado* del MRR y no lo
corrobora. El único número independiente es la mezcla de planes — y es
justamente el que discrepa. No son "dos de tres que concuerdan": es uno contra
uno.

Hipótesis sin verificar (una suscripción prorrateada, un descuento, un
redondeo de impuestos). **Hasta cerrarlo, citar el MRR como $43.29 con 5
suscriptores y no derivar de ahí una mezcla de planes.**

## Cifras vetadas (no volver a citarlas)

| Cifra que circuló | Qué pasa con ella |
|---|---|
| "89.93% usa Zenio" | Inflada. La adopción real es 2.4–9% |
| "86-89% de retención D1" | Bug de cálculo |
| "CAC promedio $0.43" (panel) | Es **costo por registro** (CPR), no CAC |
| "7 de cada 10 usan Zenio" | Milestone invalidado |

## Pendiente de confirmar

⚠️ **Las cifras del Diagnóstico de esta nota (7 pagos · $79 · $552 · 18.3%/6.7%)
se tomaron de la tabla de `docs/ESTADO_FASE_2.md`, no del PDF original.** La
reconciliación aritmética cierra, pero el PDF manda: al verificarlo, corregir
acá y quitar este aviso.

Sigue abierto, y no lo decide esta nota: **si los 8 documentos de marca se
copian al Cerebro o no**. Hoy viven en `Contenidos/`, que el indexador no
recorre, así que Kaizen no los lee. El día que se copien, esta nota es la que
evita que el conflicto llegue crudo al modelo.
