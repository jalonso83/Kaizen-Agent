# Definiciones de métricas FinZen (las que causan confusión)

Actualizado: 2026-08-20 · Fuente: sesiones de análisis Junior + Claude (dashboard interno, evals H9/H10/H13, sistema social) · Tipo: información de referencia
Ventana de datos: corte 17-ago-2026 · las cifras de campañas y adquisición son LIFETIME, no del mes
Sube a: 00-nucleo/ · Autor: Junior · Original sin tocar en `docs/recibido/2026-08-20-junior-metodo-y-conocimiento/cerebro/definiciones-metricas-finzen.md`

## Activación (el norte vigente)

**Activación = primera transacción registrada.** Decisión de junio 2026 (diagnóstico de activación): el valor que retiene es transaccionar, no chatear con Zenio (adopción real de Zenio ~6-9%, no el 89.93% inflado que circuló y quedó retirado).

La definición canónica operativa requiere fijar CUATRO decisiones, no una — distintas pantallas usan combinaciones distintas y por eso conviven cifras como 14.14% / 18.53% / 18.99% / 19.00% / 19.07% el mismo día:
1. **Ancla**: desde registro vs desde exposición a un mensaje/slot.
2. **Ventana**: 7 días cerrados vs "alguna vez" (el "Activados" de Pulso NO tiene ventana).
3. **Madurez**: si el denominador excluye a quien aún tiene la ventana abierta (hoy no la excluye: los promedios suben solos al madurar, sin que cambie el producto).
4. **Whitelist QA**: dentro o fuera (6 usuarios de diferencia entre pantallas).

## Retención

- Se lee **por cohorte de semana de registro**, nunca sobre stock. "Usuarios activos" es un stock; no se compara con métricas de cohorte.
- **Sobrevida D1→D7** = D7/D1 de la misma cohorte. Serie histórica: 64% (20-abr) → 30% (20-jul), caída monótona. Es la fuga prioritaria; ningún experimento la ha tocado (H9/H10 operan antes del día 1).
- **Decadencia D7→D30 histórica: 33-40%** (sirve para proyectar D30 con D7 en mano).
- Los paneles de cohortes **redondean a entero**: decisiones con conteos, no con el % mostrado.
- DAU/MAU **no es interpretable con la composición actual** (el MAU lo domina la entrada de campañas): cadencia mensual.

## Lead y atribución (definición de Alonso, 2026-06-08)

- **Lead** = clic en botones de descarga de la landing **solo si el visitante viene de anuncio pago**. Orgánico/directo NO cuenta. Por eso leads puede ser menor que registros; no es bug.
- En Top Sources, la columna "Registros" son **clics de descarga deduplicados atribuidos, no registros en app**.
- Consecuencia abierta (17-ago): $1,269.71 lifetime en 25 campañas con 3,741 registros atribuidos y CERO suscripciones atribuidas admite dos lecturas — el pago no convierte, o **el UTM muere en el salto a la tienda** y lo convertido cae en "Directo". Sin resolver (pregunta a Alonso: ¿install referrer / deferred deep link?).

## Sistema social (IG/TikTok) — los 5 del funnel + pulso

Orden del funnel semanal: **1) registros/leads atribuidos** (export de adquisición, UTM de bio) · **2) clicks al link** (en redefinición: visitors del export; los taps de la API de IG están deprecados) · **3) moneda social** = (saves+shares)÷alcance · **4) retención** = watch time por pieza · **5) seguidores netos 7d**. **Views y likes son pulso: se miran, no deciden producción.**

Particularidades: alcance IG semanal = suma de alcances diarios (personas-día, ~1.175× los únicos del panel) · TikTok sincroniza con ~1 día de retraso y a veces entrega "todo en cero" que se corrige al día siguiente · seguidores TikTok a nivel agregado no reflejan los +1 que sí aparecen a nivel video.

## Trampas de export (dashboard)

- Rolling 7d **subestima** activación y retención del cohorte reciente (madurez de ventana). Comparar semanales entre sí vale; contra umbral absoluto, no.
- **Nunca cruzar familias**: rolling contra rolling, calendario contra calendario (MAU difiere por construcción).
- "Salud Financiera" del export semanal es acumulada del mes: Gastos/Burn/Cobertura no se comparan semana contra semana. Cifras de costo confiables = las mensuales consolidadas.
- "Cobertura X meses" NO es runway de caja (el runway real no existe en ninguna pantalla).
- El export es una consulta en vivo: **no es idempotente**.
