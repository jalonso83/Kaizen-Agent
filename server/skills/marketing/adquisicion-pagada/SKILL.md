---
name: adquisicion-pagada
description: Úsalo al leer datos que vienen de Meta (get_meta_campaigns, get_meta_spend, get_meta_ad_results) para saber qué significa cada campo y qué puede y no puede hacer Kaizen en esa cuenta. Es solo la mecánica: qué pautar, cómo pre-registrar y cuándo evaluar está en pautas-meta (el método de Junior, que manda). Para CAC o atribución, lectura-adquisicion-finzen.
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
>
> **El método de pauta tampoco está aquí.** Qué pieza pautar, la ficha de
> pre-registro, el umbral en tres franjas, el calendario (día 3, cierre, cierre
> + 7) y la configuración estándar viven en **`pautas-meta`**, que es el método
> de Junior. **Si algo de este skill choca con `pautas-meta`, manda `pautas-meta`.**

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

## 4. Los primeros días

Meta tiene una fase de aprendizaje al arrancar una campaña, así que los primeros
días no son el rendimiento estable. Cuándo se mira y cuándo se decide lo fija el
calendario de `pautas-meta`: el día 3 **solo se buscan fallas** (no entrega,
rechazo, gasto raro) y el veredicto es 7 días después del cierre, contra el
umbral pre-registrado. No adelantes veredictos con lo que se vea antes.

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

## 7. Los campos de get_meta_ad_results

Los anuncios que propone Kaizen se pueden seguir de punta a punta porque su
nombre es su `utm_campaign`. Todo viene calculado en código: úsalo tal cual.

| Campo | Qué es | Trampa |
|---|---|---|
| `estadoMeta` | El estado real en Meta | PAUSED con 0 días con gasto: nadie la activó |
| `diasConGasto`, `primerDiaConGasto` | Días en que Meta cobró algo | Activar es manual: el primer día con gasto es cuándo la activaron |
| `ctrPct`, `costoPorClic` | Sobre clics **al enlace**, no todos los clics | Miden el anuncio, no la app (§3) |
| `alcance` | El máximo diario | Un piso, no la suma |
| `finzen.visitantes` | Visitantes de la landing con ese utm_campaign | Si es mucho menor que los clics al enlace, se pierde gente entre el clic y la página |
| `finzen.clicsDescarga` | Clics **únicos** al botón Descargar, según el tablero | **No son registros.** Confianza moderada (`pautas-meta`, Medición) |

La **métrica principal** de un experimento es el costo por cliente potencial
leído en Meta (`pautas-meta`). Esta tool todavía no lo trae: si hace falta,
dilo, y usa `costoPorClicDescarga` solo como apoyo, con su confianza.
