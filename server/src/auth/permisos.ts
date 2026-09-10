// ─────────────────────────────────────────────────────────────────────────
// Roles y permisos — la ÚNICA fuente de verdad de quién puede hacer qué.
//
// Las rutas chequean PERMISOS, nunca roles. Eso permite agregar un rol nuevo
// (o moverle un permiso a uno existente) tocando solo este archivo, sin ir
// ruta por ruta a buscar `if (rol === 'ADMIN')` — que es exactamente como se
// terminan colando los agujeros.
//
// Esconder una pestaña en el frontend NO es un permiso: es una comodidad. La
// garantía vive en requirePermission (middleware/requireAuth.ts), del lado del
// servidor, donde el navegador no llega. Si el frontend y esta tabla alguna
// vez se contradicen, manda esta tabla.
// ─────────────────────────────────────────────────────────────────────────

export const PERMISOS = [
  /** Conversar con Kaizen. Las conversaciones siguen siendo privadas de cada socio. */
  'chat',
  /** Ver la pantalla de Metas y su historial. Solo lectura. */
  'metas:ver',
  /** Confirmar o rechazar una meta propuesta. */
  'metas:confirmar',
  /** El gate: confirmar o rechazar una campaña antes de que llegue a FinZen. */
  'campanas:confirmar',
  /** Ver la pantalla de Auditoría. */
  'auditoria:ver',
  /** Cambiar la config del resumen semanal y reindexar el Cerebro. */
  'config:editar',
  /**
   * Ver el apartado de Marketing (configuración de cuentas y tablero).
   *
   * Permiso propio y no reutilizar 'config:editar': ahí adentro van a vivir
   * las URLs y las cuentas de las redes, que es información de la empresa
   * hacia afuera. Que hoy los dos los tenga solo ADMIN no los hace lo mismo —
   * el día que se quiera dar acceso a marketing al tablero sin abrirle la
   * configuración del Cerebro, se mueve una línea de este archivo.
   */
  'marketing:ver',
  /**
   * Agregar, editar o quitar las cuentas de marketing (los perfiles que Kaizen
   * lee). Separado de 'marketing:ver' por el mismo motivo que 'metas:ver' está
   * separado de 'metas:confirmar': mirar un tablero y cambiar de qué cuentas se
   * leen datos no son la misma responsabilidad, aunque hoy las tenga la misma
   * persona.
   */
  'marketing:editar',
  /** Crear socios, cambiarles el rol, habilitarlos y deshabilitarlos. */
  'usuarios:gestionar',
] as const;

export type Permiso = (typeof PERMISOS)[number];

export const ROLES = ['ADMIN', 'ASSISTANT', 'USER'] as const;
export type Rol = (typeof ROLES)[number];

/** Cómo se llama cada rol en pantalla. Los valores en BD quedan estables. */
export const ETIQUETA_ROL: Record<Rol, string> = {
  ADMIN: 'CEO / CTO',
  ASSISTANT: 'Asistente',
  USER: 'Usuario',
};

export const DESCRIPCION_ROL: Record<Rol, string> = {
  ADMIN: 'Acceso completo: chat, metas, campañas, auditoría, marketing, configuración y gestión de usuarios.',
  ASSISTANT: 'Puede conversar con Kaizen y ver las metas, pero no confirmarlas ni publicar campañas.',
  USER: 'Solo el chat. Puede conversar con Kaizen y ver lo que Kaizen le propone, sin confirmarlo.',
};

/**
 * Qué puede hacer cada rol.
 *
 * Nota deliberada sobre ASSISTANT y USER: pueden hacer que Kaizen PROPONGA una
 * campaña o una meta (proponer solo escribe en nuestra BD), pero no pueden
 * confirmarla. El gate PROPOSED→CONFIRMED sigue siendo HTTP y ahora además
 * exige permiso, así que ampliar quién usa el chat no amplía quién publica.
 */
const PERMISOS_POR_ROL: Record<Rol, readonly Permiso[]> = {
  ADMIN: PERMISOS,
  ASSISTANT: ['chat', 'metas:ver'],
  USER: ['chat'],
};

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor);
}

/**
 * Los permisos de un rol. Un rol desconocido en BD (dato viejo, migración a
 * medias, edición manual) devuelve VACÍO, no todos: ante la duda se niega, que
 * es el único error de los dos que no publica nada.
 */
export function permisosDe(rol: string): readonly Permiso[] {
  return esRol(rol) ? PERMISOS_POR_ROL[rol] : [];
}

export function puede(rol: string, permiso: Permiso): boolean {
  return permisosDe(rol).includes(permiso);
}
