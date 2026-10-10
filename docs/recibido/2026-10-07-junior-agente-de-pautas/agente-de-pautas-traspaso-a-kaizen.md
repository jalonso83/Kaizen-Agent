# Agente de pautas FinZen AI: traspaso a Kaizen

Oct 7, 2026 · @Junior Ureña

Todo lo que hace hoy el agente de publicidad pagada de FinZen AI, para que el equipo lo lleve a Kaizen: reglas, accesos, configuración, procedimiento, método y estado de los experimentos.

## Resumen

El agente decide qué pautar, lo prueba con un experimento pre-registrado, arma la campaña en Meta, la mide y escribe el veredicto. Ningún dólar se gasta sin el "sí" explícito de Junior para esa acción.

- **Lo que se copia tal cual a Kaizen:** reglas, configuración de la cuenta, método de experimentos, selección de piezas, medición y el estado de las pruebas (secciones 3 a 9).
- **Lo que NO se copia:** la forma de entrar a Meta. Hoy Claude opera el Administrador de anuncios dentro del Chrome de Junior, con su sesión ya abierta. Kaizen debe tener su propio acceso por API, con permisos mínimos (sección 2).
- **Recomendación de arranque:** Kaizen empieza en modo lectura y borradores pausados. Activar y gastar queda en manos de una persona hasta que el ciclo de lectura y veredicto lleve al menos 4 experimentos sin errores.
- **Fuentes vivas:** `claude/registro-experimentos-pautas.md` y `claude/brief-agente-pautas-finzen-ai.md` en el proyecto FinZen AI de Claude. Si algo de este documento choca con el registro, manda el registro.

## Acceso a Meta

Hoy Claude no tiene credenciales propias: opera el navegador de Junior. Kaizen necesita un acceso propio, revocable y con límites.

|  | Cómo es hoy (Claude) | Cómo debe ser en Kaizen |
| --- | --- | --- |
| Entrada | Extensión Claude in Chrome en el Chrome de Junior, con la sesión de Meta Business ya iniciada | Meta Marketing API con un usuario del sistema del portafolio FinZen AI |
| Credenciales | Ninguna. Claude nunca ve ni escribe contraseñas, ni extrae tokens de la página | Token del usuario del sistema guardado en los secretos del repo de Kaizen, nunca en el código ni en el Cerebro |
| Permisos | Los de Junior (todos) | Solo la cuenta publicitaria 998737009251372. Fase 1: solo lectura (`ads_read`). Fase 2: `ads_management` |
| Gasto | Solo con el "sí" de Junior por acción | Todo se crea en estado PAUSADO. Activa una persona, o Kaizen tras una aprobación registrada |
| Freno | Junior ve cada paso | Límite de gasto de la cuenta como tope duro, y alerta si una campaña pasa su presupuesto diario |
| Lectura de métricas | Pantallas del Administrador de anuncios | Endpoint de insights de la API, por campaña, por día, edad y sexo |

Alonso confirma en la documentación de Meta los nombres exactos de permisos y campos antes de configurar. \[verificar\]

**Por qué no copiar el método de hoy:** compartir la sesión de Junior le daría a un sistema automático todos sus permisos, sin tope de gasto. Además, la interfaz cambia seguido y rompe los clics (sección 10); la API no.

## Reglas que no se negocian

1. **Nada se publica, activa, sube de presupuesto ni gasta sin el "sí" explícito de Junior para esa acción.** Un "sí" no vale para la siguiente.
2. **Pre-registro antes de gastar:** hipótesis, variable, métrica, umbral y fecha de lectura escritos antes de publicar. Después no se mueve la vara.
3. **Una variable por prueba.** Si cambian objetivo y pieza a la vez, no se sabe qué causó el resultado.
4. **Nunca optimizar por "Registro completo"** (decisión de junio 2026). El evento es "Cliente potencial", el toque en "Descargar" de finzenai.com.
5. **No tocar los 2 borradores viejos** de "Revisar y publicar". Publicar siempre desde el editor de la campaña propia.
6. **No cambiar bio, perfil ni configuración de la cuenta** sin permiso.
7. **Nunca escribir contraseñas, datos de pago ni tokens** en ningún campo, ni extraerlos de una página.
8. **Marca:** FinZen AI, tono Gen Z. Nunca marca ULP en piezas ni textos de FinZen.
9. **Honestidad del veredicto:** "no se puede concluir" es un resultado válido. Toda afirmación importante lleva nivel de confianza (alta, moderada, baja).
10. **Si el cuello de botella no es la pauta** (por ejemplo, retención en la app), decirlo aunque implique gastar menos.
11. **Comentarios de usuarios en los anuncios** que hablen del producto se pasan al hilo de Producto, sin nombres ni usuarios.

## Cuenta y configuración estándar

Esta es la configuración por defecto desde EXP-P01: objetivo clientes potenciales, solo Instagram, público "Prueba 1". Cualquier desvío es una variable de experimento y se pre-registra.

| Elemento | Valor |
| --- | --- |
| Cuenta publicitaria | FinZen AI, 998737009251372 |
| Portafolio | FinZen AI, 1291988099540778 |
| Activo de Instagram (Business Suite) | 1008448722361567 |
| Identidades | Página FinZen AI + @finzenaiapp. En piezas de colaboración, anuncio entre socios con @juniorurena (FinZen AI primero) |
| Objetivo | Clientes potenciales, ubicación de conversión "Sitio web" |
| Conjunto de datos y evento | "Datos FincenAI" (así escrito en Meta), evento "Cliente potencial" |
| Puja y presupuesto | Volumen más alto, presupuesto diario de campaña |
| Público | Audiencia guardada "Prueba 1": República Dominicana, 18+, sugerencia de edad 18 a 40 |
| Ubicaciones | Solo Instagram: feed, historias, inicio de Explorar, reels, feed del perfil, resultados de búsqueda |
| URL de destino | https://www.finzenai.com/ |
| Llamada a la acción | "Ver detalles" |
| Mejoras Advantage+ | Activadas: mejoras en el texto, comentarios pertinentes, mejorar llamada a la acción. Desactivada: mostrar resumen |
| Parámetros de URL | `utm_source=meta&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{placement}}` |
| Enlace de la bio | `www.finzenai.com/?utm_source=instagram&utm_medium=bio_organico&utm_campaign=perfil_ig` (desde el 26/07/2026) |
| Nombres | Campaña `EXP_P0N_<Pieza>_<DDMMAA de arranque>`, conjunto `EXP_P0N_<Objetivo>`, anuncio `EXP_P0N_<Pieza>` |

Ojo con los nombres de EXP-P01: dicen 051026 porque era la fecha planeada, pero arrancaron el 28/09/2026. Desde EXP-P02 la fecha del nombre es la de arranque real.

## Procedimiento para lanzar una campaña

Así se armó y publicó EXP-P02 el 03/10/2026. En Kaizen, los pasos 2 a 6 se hacen por API creando todo en PAUSADO; los pasos 1, 7 y 9 son iguales.

1. **Pre-registrar y aprobar.** Escribir la ficha del experimento (sección 6) y obtener el "sí" de Junior a pieza, presupuesto y fechas.
2. **Duplicar la campaña de referencia.** Campañas, filtrar por nombre, marcar la campaña (hoy `EXP_P01_A_Descargas_051026`), Duplicar, elegir "Original" (no la sugerencia de Meta), **desmarcar todas las recomendaciones** (formularios instantáneos, imagen extra, ubicaciones Advantage+), 1 copia, Duplicar. Queda en borrador.
3. **Campaña.** Renombrar con la nomenclatura y fijar el presupuesto diario.
4. **Conjunto.** Renombrar. Revisar fecha de fin (Meta la propone sola), público "Prueba 1" y ubicaciones solo Instagram.
5. **Anuncio.** Renombrar. "Cambiar publicación", ubicar el reel por fecha o por ID y Continuar. Confirmar ID de la publicación, URL, llamada a la acción y parámetros UTM.
6. **Verificar en la pestaña "Revisar"** del conjunto: fechas, público, sugerencia de edad, ubicaciones, objetivo y evento. Si algo difiere de la sección 4, corregir antes de seguir.
7. **Pedir el "sí" para publicar** con un resumen de una línea: nombre, US$ por día, fechas, pieza.
8. **Publicar desde el editor de la campaña:** "Obtener vista previa para publicar", revisar que la vista previa muestre solo esta campaña, "Publicar". Debe decir "Publicando 3 de 3" (campaña, conjunto, anuncio) y "Revisar y publicar" debe seguir en (2).
9. **Registrar y programar.** Anotar estado, hora e IDs en el registro. Programar chequeo del día 3, cierre el día de fin y veredicto 7 días después del cierre.

## Método de experimentos

Cada prueba tiene una ficha escrita antes de gastar, con estos campos. Ejemplo completo: EXP-P02 en el registro.

| Campo | Qué lleva |
| --- | --- |
| Código y fecha de pre-registro | EXP-P0N, DD/MM/AAAA |
| Hipótesis | Una oración que se pueda refutar |
| Variable que cambia | Una sola (objetivo, pieza, público, ubicación) |
| Lo que se mantiene igual | Todo lo demás, explícito |
| Brazos o comparador | Simultáneo si se puede; si no, histórico, y se anota como confusor |
| Presupuesto y fechas | US$ por día, inicio y fin |
| Métrica principal | Hoy: costo por cliente potencial |
| Métricas de apoyo | Costo por visita a la landing, CTR, tasa de 3 s, tiempo medio, frecuencia, registros en el tablero, D7 de la cohorte |
| Umbral de decisión | Tres franjas: gana, empate, pierde, con la acción de cada una |
| Predicción | La del agente, con confianza |
| Confusores | Eventos, pruebas gratis, publicaciones orgánicas, cansancio de la pieza |
| Fecha de lectura | 7 días después del cierre |
| Resultado, veredicto, lección | Se llenan al final, sin mover el umbral |
| Aprobación de Junior | Fecha y cita textual por cada paso aprobado |

**Regla de umbral usada:** gana si mejora 15% o más contra el comparador; empate dentro de ±15%; pierde si empeora 15% o más.

**Calendario por experimento:** chequeo del día 3 (¿entrega bien?, sin tocar salvo falla), cierre el último día (fotos de todas las métricas) y veredicto 7 días después. La retención D7 y D30 solo se lee con cohortes de 4 semanas o más.

## Medición y atribución

Solo se puede leer con confianza la parte alta del embudo: del anuncio al toque en "Descargar". De la tienda en adelante no hay rastro por campaña, así que ningún ROI, CAC ni retención por campaña es defendible todavía.

| Qué se mide | Dónde | Confianza |
| --- | --- | --- |
| Gasto, clientes potenciales, CTR, visitas a la landing, frecuencia, tasa de 3 s, edad y sexo | Administrador de anuncios (o insights de la API) | Alta |
| Visitantes, leads y "registros" por campaña | Tablero interno, finzenai.com/dashboard/detalles, pestaña Adquisición, Top Sources | Moderada: los "registros" son un porcentaje asumido después del toque en Descargar |
| Tráfico desde la bio | Fila `instagram · bio_organico · perfil_ig` de Top Sources | Moderada: mezcla todas las fuentes |
| Seguidores ganados | Captura de Seguidores de la app de Instagram, antes y después | Moderada |
| Registros por día | Gráfica del tablero, comparada con los días de pauta | Baja a moderada |

**Detalles que importan:**

- Top Sources es acumulado de por vida, no filtra por fecha. Para medir una ventana, foto de la fila antes de publicar y después del cierre.
- Las campañas de clientes potenciales entran solas al tablero por el UTM. Las de visitas al perfil las carga Alonso a mano.
- Para seguidores: línea base antes de publicar y descontar los que vengan de otros contenidos (ranking "Contenido por seguidores" de la semana).
- Propuesta pendiente con Alonso para cerrar la atribución: pregunta "¿Cómo conociste FinZen AI?" en el registro y Google Play Install Referrer en Android.

## Cómo elegir la pieza a pautar

El rendimiento orgánico es el primer filtro, no la decisión final. La decisión sale de una prueba pagada pequeña.

1. **Filtro orgánico:** moneda social = (compartidos + guardados) por cada 1,000 cuentas alcanzadas, solo orgánico, a 7 días. Pasa si supera la mediana de su cuenta y formato (reels de @finzenaiapp: \~12 al 03/10/2026).
2. **Confirmar que nunca se pautó:** si las vistas totales son parecidas a las orgánicas, no se pautó. Las pautadas tienen decenas de miles de vistas.
3. **Revisar el arranque:** si casi nadie pasa de los primeros 3 segundos en orgánico, en anuncio suele costar más.
4. **Revisar la música:** Meta puede silenciar música popular en anuncios.
5. **Prueba pagada pequeña** (US$40 a US$60, 4 a 5 días) contra el comparador, con umbral pre-registrado.
6. **Escalar** solo la pieza que gane, y rotarla con la anterior para frenar el cansancio.

**Fuente de los datos orgánicos:** el Laboratorio de reels (artefacto con base de datos, colección `piezas`) y `finzen/laboratorio-reels-aprendizajes.md` en el vault de Junior.

**Candidatas al 03/10/2026, nunca pautadas:** "Muchos crecimos sin educación financiera" (15/08, moneda social 26.5) y "¿Sabes cuánto vales financieramente?" (31/08, 21.3). Descartada por ahora: "Fue solo una pesadilla" (alcance 47 a 72 horas, 0 compartidos).

## Estado actual de los experimentos

EXP-P01 dejó "clientes potenciales" como objetivo por defecto. EXP-P02 está corriendo y prueba si una pieza orgánica ganadora abarata el costo.

| Experimento | Qué prueba | Fechas y gasto | Resultado | Estado |
| --- | --- | --- | --- | --- |
| EXP-P02 | Reel "Eso es lo que buscamos" (15/09) con objetivo clientes potenciales, contra US$0.11 de EXP-P01 A | 03/10 al 08/10/2026, US$10 por día, \~US$50 | Pendiente. Gana si cuesta ≤ US$0.095 por cliente potencial; empate hasta US$0.127 | Corriendo. Cierre 08/10, veredicto 10/10 |
| EXP-P01 | Objetivo clientes potenciales (A) contra visitas al perfil (B), misma pieza "¿Te unes?" | 28/09 al 03/10/2026, US$25 por brazo | A: 227 clientes potenciales a US$0.11, 421 visitas a la landing. B: 611 visitas al perfil a US$0.04, \~68 seguidores netos sin contar la Expo (\~US$0.37 cada uno o más) | Preliminar: A gana para descargas (confianza alta). B queda en franja media. Veredicto formal 10/10 |

Registro completo con todas las métricas: `claude/registro-experimentos-pautas.md`.

## Trampas conocidas del Administrador de anuncios

Sirven si alguien opera la interfaz a mano; por API la mayoría desaparece.

- **"Revisar y publicar (N)" publica todos los borradores juntos.** Hay 2 borradores viejos ahí: nunca usar ese botón.
- **Al duplicar, Meta propone otra campaña "de alto rendimiento"** y marca recomendaciones por defecto. Elegir "Original" y desmarcar todo.
- **Quitar Facebook de las ubicaciones puede borrar el creativo.** Hay que volver a elegir la publicación existente.
- **Error "páginas no coinciden" (#2142071)** en anuncios entre socios: poner la página FinZen AI como primera identidad y @juniorurena como segunda, y volver a elegir la publicación.
- **Objetivo visitas al perfil:** exige llamada a la acción "Ir al perfil de Instagram" y no admite anuncios multianunciante.
- **El buscador de publicaciones no encuentra por texto del pie.** Buscar por ID o desplazarse por fecha.
- **Campos de hora:** escribir "00" no funciona, usar las flechas.
- **No usar Escape dentro del editor:** puede abrir el diálogo de publicar.
- **La tabla de anuncios solo muestra unas 7 filas:** filtrar por nombre de campaña para ver las que interesan.

## Bloque para el system prompt de Kaizen

Listo para pegar como módulo de pautas dentro del prompt de Kaizen. Las cifras viven en el registro, no aquí.

```text
MÓDULO: PAUTAS EN META (FinZen AI)

ROL
Eres el estratega de pautas y científico de experimentos de FinZen AI. Cada dólar debe comprar aprendizaje verificable y, cuando se pueda, usuarios que se quedan. En esta etapa (pre-PMF) la pauta genera tráfico y registros, no suscripciones: si el cuello de botella es la retención en la app, dilo.

LÍMITES DUROS
1. Nunca publiques, actives, subas presupuesto ni gastes sin aprobación humana registrada para esa acción. Una aprobación no sirve para la siguiente.
2. Todo lo que crees en Meta nace en estado PAUSADO.
3. Solo operas la cuenta publicitaria 998737009251372. No tocas borradores ajenos, bio, perfil ni configuración de la cuenta.
4. Nunca escribes ni expones tokens, contraseñas ni datos de pago. Nunca incluyes datos personales de usuarios en reportes.
5. Nunca optimizas por "Registro completo". El evento es "Cliente potencial".

MÉTODO
- Antes de gastar, escribe la ficha de pre-registro: hipótesis, una sola variable, comparador, presupuesto y fechas, métrica principal, umbral en tres franjas (gana ≥15% mejor, empate ±15%, pierde ≥15% peor), predicción con confianza, confusores, fecha de lectura.
- No muevas el umbral después de ver datos. "No se puede concluir" es un resultado válido.
- Calendario: chequeo día 3 (solo detectar fallas), cierre el último día, veredicto 7 días después. Retención por cohorte solo con 4+ semanas.
- Toda afirmación material lleva confianza: alta, moderada o baja.
- Al cerrar cada experimento, escribe resultado, veredicto, lección y siguiente hipótesis en el registro. Sin ese paso el ciclo no está completo.

SELECCIÓN DE PIEZAS
- Filtro: moneda social orgánica a 7 días = (compartidos + guardados) / alcance x 1,000, por encima de la mediana de su cuenta y formato.
- Confirma que nunca se pautó y que su arranque retiene. Luego prueba pequeña contra el comparador.

CONFIGURACIÓN POR DEFECTO
Objetivo clientes potenciales, sitio web, evento "Cliente potencial" del conjunto de datos "Datos FincenAI". Audiencia guardada "Prueba 1" (RD, 18+, sugerencia 18 a 40). Solo Instagram. URL https://www.finzenai.com/ con utm_source=meta&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{placement}}. Nombres EXP_P0N_<Pieza>_<DDMMAA>.

MEDICIÓN
Con confianza solo se lee hasta el toque en "Descargar". Los "registros" del tablero son un porcentaje asumido. No reportes ROI, CAC ni retención por campaña como hechos.

ESTILO
Español, versión corta primero, fechas DD/MM/AAAA, montos con US$ o RD$, sin rayas largas.
```

## Pendientes y decisiones abiertas

- [ ] Alonso: crear el usuario del sistema en el portafolio, con acceso solo a la cuenta 998737009251372, y guardar el token en los secretos de Kaizen
- [ ] Junior: decidir el límite de gasto de la cuenta y quién aprueba en Kaizen cuando él no esté
- [ ] Junior y Alonso: definir cómo queda registrada la aprobación humana (mensaje, botón, firma en el registro)
- [ ] Alonso: cargar EXP\_P01\_B en el tablero y poner fecha e inversión a EXP\_P01\_A (28/09, US$25.10)
- [ ] Alonso: aclarar de dónde salen leads y registros en las filas cargadas a mano, y corregir la inversión cruzada de 020926 y 070926
- [ ] Alonso: pregunta "¿Cómo conociste FinZen AI?" en el registro de la app y Google Play Install Referrer
- [ ] Equipo de Kaizen: decidir si el registro de experimentos vive en el Cerebro (`50-kaizen/`) o sigue en el proyecto de Claude, y cuál manda
- [ ] Claude: entregar los veredictos de EXP-P01 y EXP-P02 el 10/10/2026 y actualizar este documento
