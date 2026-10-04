---
name: adquisicion-pagada
description: Úsalo al leer datos que vienen de Meta con get_meta_campaigns o get_meta_spend, y SIEMPRE antes de propose_meta_ad — qué significa cada campo, cómo elegir un post para promocionar, y qué puede y no puede hacer Kaizen en esa cuenta. Para interpretar CAC, atribución o si la pauta rinde, el skill es lectura-adquisicion-finzen.
---

# Los datos de Meta: qué son y qué puede hacer Kaizen

Este skill cubre **solo la mecánica de la integración con Meta**: cómo leer los
campos que devuelven `get_meta_campaigns` y `get_meta_spend`, y cuáles son los
límites de lo que Kaizen puede hacer en esa cuenta.

> **El método de lectura de adquisición NO está aquí.** CAC en tres niveles, la
> ambigüedad de atribución que hoy invalida cualquier lectura de ROI, el test de
> la restricción vinculante y cómo reportarlo viven en
> **`lectura-adquisicion-finzen`**. Carga ese skill antes de concluir nada sobre
> si la pauta rinde. Este solo te dice qué significan los números que Meta manda.

## 1. Lo primero: ¿está gastando o no?

`status` es lo que alguien pidió. `effective_status` es lo que Meta realmente
aplica. Una campaña puede estar `ACTIVE` y no gastar un peso porque el conjunto
de anuncios está pausado, la cuenta está inhabilitada o el anuncio fue
rechazado.

**Reporta siempre `effective_status`.** Decir "hay 3 campañas activas" cuando dos
están frenadas es el error más fácil de cometer y el más difícil de detectar
después. La tool ya trae el campo `gastando` calculado: úsalo.

## 2. Moneda y zona horaria

Los importes vienen en la moneda de la **cuenta de Meta**, que puede no ser
dólares. Mira `account.currency` y di la moneda al dar cualquier cifra.

Las fechas son días de la zona horaria de la cuenta. Si la cuenta está en otra
zona que FinZen, el "ayer" de Meta no es el mismo día que el "ayer" de los KPIs.
Cuando compares ventanas entre las dos fuentes, di qué ventana usaste en cada
una. Es un caso más de lo que cubre `verificar-comparabilidad`: dos puntas que
parecen el mismo día y no lo son.

## 3. Qué mide cada campo, y dónde muere

| Métrica | Qué dice | Trampa |
|---|---|---|
| **spend** | lo que Meta cobró | No es el costo de adquisición. Ver `lectura-adquisicion-finzen` §4 |
| **CPM** | costo por mil impresiones | Barato no es bueno: un CPM bajo suele significar audiencia de mala calidad |
| **CTR** | % de impresiones que dieron clic | Mide el *anuncio*, no el producto. Un CTR alto con cero registros es un anuncio que promete algo que la app no cumple |
| **CPC** | costo por clic | Solo importa si los clics se convierten. CPC bajo con conversión cero es gasto puro |

La cadena es: impresión → clic → registro → activación → pago. **Cada métrica de
Meta muere en el paso "clic".** Todo lo que pasa después lo sabe FinZen, no Meta
— y hoy ni siquiera FinZen lo sabe con certeza, porque la atribución puede
romperse en el salto a la tienda (`lectura-adquisicion-finzen` §2).

Consecuencia práctica: un embudo que se rompe después del clic no se arregla
cambiando el anuncio.

## 4. Ventana de aprendizaje

El algoritmo de Meta tiene una fase de aprendizaje al arrancar una campaña. Los
primeros días no representan el rendimiento estable, así que **una campaña con
menos de 7 días corriendo no se evalúa**, ni para bien ni para mal.

## 5. Nunca compares una campaña de Meta contra el lift de una interna

Son cosas distintas medidas de forma distinta: las internas tienen grupo de
control (holdout) y las de Meta no. Ponerlas en la misma tabla como si fueran
comparables es una lectura que no se sostiene.

## 6. Lo que Kaizen NO puede hacer en Meta

- **No puede activar campañas.** La herramienta de creación deja todo en pausa y
  no existe forma de que Kaizen la des-pause: eso es un humano entrando a Ads
  Manager. Si el socio pide "actívala", explica que no puedes y que tiene que
  hacerlo él.
- **No puede pasarse del tope de presupuesto diario** configurado. Si el socio
  pide más, di cuál es el tope y que se cambia por configuración, no por chat.
- **No puede convertir monedas.** Si la cuenta factura en una moneda distinta de
  la del tope, el sistema rechaza en vez de aplicar un tipo de cambio. Di que
  hay que redefinir el tope en la moneda de la cuenta.
- **No elige el presupuesto, la duración, el objetivo, el destino ni a quién.**
  Salen de Configuración → Publicidad automática y los fija un admin.
  propose_meta_ad no tiene dónde recibirlos. Si el socio quiere otros, se
  cambian ahí.
- **Solo promociona posts de Instagram propios.** El id se verifica contra la
  cuenta de FinZen; un post de un competidor o uno inventado se rechaza.

Estas no son reglas que estés siguiendo por buena voluntad: son límites del
código. Dilo así si te preguntan — es más honesto y más tranquilizador que
prometer que te vas a portar bien.
## 7. Proponer un anuncio (propose_meta_ad)

Kaizen puede proponer **promocionar un post de Instagram de FinZen que ya está
publicado**. La tarjeta no gasta: al confirmarla, el sistema crea la campaña
**en pausa**, y la activa un humano en Ads Manager.

**Cómo elegir el post**, con los datos de get_instagram_profile:

1. **Rindió claramente mejor que la mediana de la cuenta** en interacciones.
   Con 2 o 3 piezas virales, el promedio miente: compara contra la mediana
   (`resumen_publicaciones.likes_mediana`). Un post que está en la mediana no
   tiene por qué rendir mejor pagado.
2. **Se entiende sin contexto.** Quien lo va a ver no sigue a FinZen. Un
   chiste interno, una respuesta a un comentario o un post que depende del
   anterior no sirven.
3. **Vende algo que la app hace hoy.** Si el post promete una función que no
   existe o un resultado ("ahorra X"), no se promociona: regla de marca.
4. **Es reciente** (idealmente de los últimos 60 días) y **no se promocionó**
   en la ventana de rotación (la tool lo rechaza igual).
5. **No compite con lo que ya corre.** Mira get_meta_campaigns: si hay una
   campaña activa con el mismo tema, dilo y no propongas otra encima.

**El racional lleva cifras**: interacciones del post contra la mediana, tipo
(reel o carrusel) y fecha. **La medición** dice qué se mira y cuándo: CTR y
CPC a los 7 días como mínimo (§4: antes no se evalúa), y los registros con
ese `utm_campaign` en get_kpis. El nombre de la campaña ES el utm_campaign,
así que el cruce con FinZen sí une para las campañas que crea Kaizen.

**Si ningún post cumple, no propongas.** Es una respuesta válida y mejor que
pagar para empujar una pieza mediocre.

**Antes de proponer, mira cómo rindieron los anteriores** con
get_meta_ad_results. Si un tipo de pieza (reel, carrusel) o un tema tuvo un
costo por clic a descargar claramente peor que otro, no repitas lo que no
funcionó sin decir por qué esta vez sería distinto.

## 8. Evaluar un anuncio de Kaizen (get_meta_ad_results, record_meta_ad_evaluation)

Los anuncios que propone Kaizen se pueden medir de punta a punta porque su
nombre es su `utm_campaign`. get_meta_ad_results trae todo calculado en
código: úsalo tal cual y no recalcules.

**Qué significa cada número:**

| Campo | Qué es | Trampa |
|---|---|---|
| `diasConGasto` | Días en que Meta cobró algo | Activar es manual: el primer día con gasto es cuándo la activaron |
| `ctrPct`, `costoPorClic` | Sobre clics **al enlace**, no todos los clics | Miden el anuncio, no la app (§3) |
| `finzen.visitantes` | Visitantes de la landing con ese utm_campaign | Si es mucho menor que `clicsEnlace`, se pierde gente entre el clic y la página (carga lenta, enlace roto) |
| `finzen.clicsDescarga` | Clics **únicos** al botón Descargar | **No son registros ni suscripciones.** La atribución se puede perder en la tienda (lectura-adquisicion-finzen §2) |
| `costoPorClicDescarga` | gasto / clics a descargar | La mejor medida que hay hoy del anuncio de punta a punta |

**Cuándo evaluar:** con `evaluable: true` (7 días con gasto o más). Antes, la
tool de evaluación lo rechaza; tú tampoco adelantes veredictos.

**Contra qué comparar**, en este orden:
1. Los otros anuncios de Kaizen (get_meta_ad_results sin ad_id).
2. Las campañas pagadas de FinZen en get_meta_spend, con su CTR y CPC.
3. Si no hay con qué comparar, dilo: "es el primero, no hay base". No
   inventes un benchmark.

**Las tres recomendaciones:**
- **seguir:** el costo por clic a descargar es igual o mejor que la
  comparación, y el gasto va según lo previsto.
- **cambiar_post:** el CTR es bajo contra la comparación, pero la cadena
  después del clic funciona (visitantes y clics a descargar en proporción).
  Lo que falla es la pieza.
- **pausar:** gasta sin traer clics a descargar, o el costo por clic a
  descargar es varias veces peor que la comparación. También si visitantes
  es casi cero con clics al enlace altos: hay algo roto en la landing y no
  se arregla pagando más.

**En la razón van las cifras** de la lectura y la comparación. Siempre
termina con lo que tiene que hacer el socio: con seguir, nada; con pausar o
cambiar_post, hacerlo en Ads Manager (tú no puedes).
