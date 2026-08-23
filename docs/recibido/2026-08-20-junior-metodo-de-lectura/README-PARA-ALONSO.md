# Método de análisis de reportes → Kaizen

**De:** Junior
**Para:** José Luis Alonso
**Fecha:** 20 de agosto de 2026
**Responde a:** tu pedido del 20 de agosto

---

Va separado en dos como pediste. Antes de los archivos, tres cosas que necesitas saber para decidir qué entra tal cual y qué hay que sustituir.

## 1. Qué te mando

**Cuatro skills** (`skills/<slug>/SKILL.md`), todos por debajo de 100 líneas:

| Slug | Qué cubre | Se dispara cuando |
|---|---|---|
| `lectura-kpis-finzen` | Las seis trampas verificadas del tablero, cohorte contra período, y qué hacer con n chico | Vas a interpretar cualquier KPI agregado |
| `lectura-adquisicion-finzen` | CAC en tres niveles, la ambigüedad de atribución, el test de la restricción vinculante | Vas a evaluar campañas o recomendar presupuesto |
| `lectura-retencion-cohortes` | Sobrevida D1 a D7 como métrica que gobierna, madurez de ventana, bandas | Vas a interpretar retención |
| `verificar-comparabilidad` | El chequeo obligatorio antes de cualquier delta | Siempre, antes de decir "subió" o "bajó" |

**Tres notas de Cerebro** (`cerebro/`): glosario y lo que cada métrica NO significa, registro fechado de rupturas de serie, y umbrales del negocio con las decisiones pasadas y su porqué.

**Cómo apliqué tu separación, con un ejemplo concreto:** la *regla* de que ninguna comparación vale si hay una ruptura entre las dos puntas es instrucción y quedó en `verificar-comparabilidad`. La *lista fechada* de las siete rupturas de FinZen es información y quedó en el Cerebro. Así la lista se actualiza sin PR y la regla no.

## 2. Lo que NO tiene sustituto en Kaizen, que era tu pregunta

Contrasté el método contra las doce tools que listaste:

| Paso del método | En Kaizen | Nota |
|---|---|---|
| Sacar el reporte del dashboard | **Sin sustituto directo.** Depende de `get_kpis` | Ver pregunta 1 abajo |
| Leer y estructurar los números | `get_kpis`, `get_campaign_results`, `list_segments` | Transfiere |
| Aplicar el método de lectura | Los cuatro skills | Transfiere completo |
| Cruzar contra rupturas y decisiones | `search_cerebro` | Transfiere |
| **Calcular intervalos de confianza y poder** | **Sin sustituto si Kaizen no ejecuta código** | Resuelto con tablas de consulta dentro de los skills, en vez de fórmulas |
| Voz de usuario (reviews, feedback) | **Ninguna tool lo cubre** | El bloque 5 del schema queda vacío por construcción |
| Producir el documento y archivarlo | `save_cerebro_note` aproxima | El entregable pasa de documento a nota |
| Borrador de correo | Sin tool, y está bien así | Por diseño, no por límite |

**El único que me preocupa es el de aritmética.** El método usa márgenes de error de forma rutinaria: con cohortes de 40 a 500 registros, la mitad de los movimientos semanales no son señal. Si Kaizen no puede calcular, el agente necesita la tabla precomputada o va a reportar caídas que no existen. Se la metí a `lectura-kpis-finzen` con siete filas. Si sí puede calcular, cámbiala por la fórmula de Wilson y queda más limpio.

## 3. Cinco preguntas que necesito para cerrar

1. **¿Qué campos devuelve `get_kpis`?** En concreto: ¿trae D1, D7 y D30 **por cohorte de semana de registro**, o solo agregados del período? `lectura-retencion-cohortes` no se puede ejecutar sin granularidad de cohorte, y sin ella la mitad del método se cae.
2. **¿Kaizen ejecuta aritmética o código?** Decide si las tablas de consulta se quedan o se vuelven fórmulas.
3. **¿Hay alguna tool de feedback o reviews que no esté en tu lista?** Si no la hay, la voz de usuario sale del alcance y conviene decirlo explícito en vez de dejar el hueco.
4. **`get_campaign_results`: ¿trae columna de suscripciones, y es del período o lifetime?** La tabla del dashboard es lifetime y eso cambia por completo cómo se lee.
5. **¿Dónde aterriza la salida semanal?** ¿`save_content_draft`, `save_cerebro_note`, o algo que no está en la lista?

## 4. Lo que deliberadamente no escribí

**Nada de diseño de experimentos.** Ya tienes `diseno-experimentos` y no lo conozco, así que no voy a duplicarlo. Pero hay tres reglas del método que si no están ahí, valen: (a) un experimento con brazo control se lee **brazo contra brazo, nunca contra la serie histórica**, porque la comparación no concurrente se contamina con el cambio de mezcla de tráfico y la concurrente no; (b) el poder se calcula sobre la **población del punto de asignación**, que en H13 son los activados y no los registrados, y eso cambia el plazo de semanas a meses; (c) umbral escrito antes del deploy y sin peeking. Revísalas contra lo que ya tienes y quédate con lo que falte.

**Nada de acciones de campaña ni de copy.** Lo mío es la capa de lectura, que alimenta a `campanas-retencion` y `copy-push`. Si la frontera queda borrosa en algún punto, córrela tú.

**No calibré el tono contra los cinco skills existentes** porque no tengo acceso al repo. Si el registro te queda largo o corto, dímelo y lo ajusto en una pasada.

---

Si algo cayó en la casilla equivocada, muévelo sin preguntarme. Prefiero eso a que se quede parado.
