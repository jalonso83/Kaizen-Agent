# Mapa de entrega: método y conocimiento para Kaizen

**De:** Junior (con Claude) · **Para:** José Luis Alonso · **Fecha:** 20-ago-2026
**Responde a:** "Pasar tus agentes de análisis a Kaizen" (20-ago)

## Qué contiene el paquete

**5 skills (método, van al repo con PR)** en `skills/<slug>/SKILL.md`, listos para `server/skills/`:

| Skill | Oficio que cubre |
|---|---|
| `lectura-kpis` | Convertir cifras en señal: orden de lectura, comparaciones válidas, madurez de ventana |
| `sanidad-datos` | Tubería vs realidad antes de declarar récord o caída; tabla causa → acción |
| `lectura-experimentos` | Emitir veredicto al vencer una ventana: pre-registro manda, piso de n, cierre al Cerebro |
| `umbrales-semaforo` | Fijar y aplicar verde/ámbar/rojo sin trampa: dos cortes, calibración con periodos limpios |
| `top-flop-hipotesis` | Leer resultados de mensajes/campañas y decidir qué se repite, pausa o prueba |

**4 notas (conocimiento, van al Cerebro)** en `cerebro/`: `definiciones-metricas-finzen` (activación, lead, las 4 decisiones de la definición canónica, trampas de export), `rupturas-de-serie-y-baselines` (la lista completa con fechas y las líneas base congeladas), `umbrales-vigentes-y-propuestos` (firmados vs propuestos, con estado), `decisiones-cerradas-no-relitigar` (lo desestimado, lo vetado y el contexto de fase).

La separación sigue tu regla: en los skills solo hay instrucciones de cómo leer; toda cifra, fecha y decisión vive en las notas del Cerebro y los skills la buscan con `search_cerebro`.

## Solapes con los 5 skills existentes (son complementos, no reemplazos)

- `lectura-kpis` corre ANTES de `resumen-semanal`: uno produce la señal, el otro la presenta.
- `lectura-experimentos` es el espejo de `diseno-experimentos`: ese diseña antes, este lee después y escribe el aprendizaje.
- `top-flop-hipotesis` produce el insumo de `campanas-retencion`, `copy-push` y `conceptos-contenido`.
Si prefieres fusionar alguno con un skill existente, adelante; el corte por oficio fue deliberado para que cada uno quede corto.

## Lo que NO mapeó (depende de pantalla o de fuentes que Kaizen no tiene)

1. **El export del PDF del dashboard** (se genera en navegador): queda del lado local nuestro.
2. **La lectura del sistema social IG/TikTok** (Windsor + panel nativo): el método sí quedó en los skills porque es general, pero Kaizen no tiene la fuente de datos social. Si en F2 le sumas un feed social, `lectura-kpis`, `umbrales-semaforo` y `top-flop-hipotesis` aplican tal cual.
3. **Verificaciones en panel nativo** (restricciones de cuenta, estado de distribución): humanas por ahora.

## Amarres con la auditoría del system prompt (26-jul)

Tres hallazgos de esa auditoría quedan cubiertos en la capa de instrucciones: el **piso de n** (P0-2: inferir mal con cifras verdaderas) vive en `lectura-experimentos` y `sanidad-datos`; el **cierre del bucle** (leer resultados y escribir el aprendizaje al Cerebro) es paso obligatorio de `lectura-experimentos`; el **anti-relitigio** vive en la nota `decisiones-cerradas-no-relitigar` más los pasos 0 de cada skill. Los tres P0 de Fase 1 (KPI norte, umbral, definición de activado) siguen siendo decisiones de negocio, no de skills; las notas documentan el estado vigente para que el agente no lo contradiga mientras ustedes las cierran.

## Avisos

- **Los umbrales sociales de la nota de umbrales están PROPUESTOS, no firmados** (pendientes de aprobación de Junior, cita del 17-ago). La nota lo marca; cuando se aprueben se actualiza.
- Todas las cifras salen de los reportes y bases de las sesiones de análisis (verificadas contra fuente). Si algo contradice lo que ves en el repo o el dashboard, gana el repo: márcalo y lo corregimos.
- Entrego borradores en Markdown (tu opción B). Si prefieres PR, dime el repo y lo armamos.
