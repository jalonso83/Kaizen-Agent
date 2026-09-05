// ─────────────────────────────────────────────────────────────────────────
// Se importa PRIMERO en cada archivo de prueba (el orden de los `import`
// manda en ESM), antes de cualquier módulo de la app.
//
// Por qué hace falta: `config.ts` hace process.exit(1) si falta una variable
// requerida y `db.ts` construye el PrismaClient al importarse. Estas pruebas
// son de lógica pura y no tocan ni la BD ni la red, pero importan módulos que
// arrastran a esos dos — así que necesitan valores con forma válida, no
// valores reales. Mismo atajo que documenta TESTING.md §"sin credenciales".
//
// `??=` y no `=`: si alguien corre las pruebas con un .env de verdad cargado,
// no se lo pisamos.
// ─────────────────────────────────────────────────────────────────────────
process.env.DATABASE_URL ??= 'postgresql://kaizen:kaizen@localhost:5432/kaizen_pruebas';
process.env.JWT_SECRET ??= 'secreto-de-pruebas-no-usar-en-produccion';
process.env.FINZEN_API_URL ??= 'http://localhost:4010';

// Las pruebas NUNCA llaman a la API de visión: cuesta dinero y necesitaría una
// key real. Esto se fuerza con `=` y no con `??=` a propósito — es una garantía,
// no un default: aunque quien corra las pruebas tenga un .env con la lectura de
// imágenes encendida, acá queda apagada.
process.env.CEREBRO_VISION_ENABLED = 'false';
