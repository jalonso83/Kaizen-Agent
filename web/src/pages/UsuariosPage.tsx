import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Partner, RolInfo, Rol, Usuario } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// Pantalla de Usuarios (solo rol CEO / CTO).
//
// Esta pantalla NO decide nada: solo dibuja lo que el servidor permite y
// muestra lo que el servidor responde cuando algo se niega. Toda la
// autorización vive en server/src/auth/permisos.ts y en requirePermission.
//
// Decisión deliberada: no hay botón de borrar. Se habilita y se deshabilita.
// Borrar a alguien se lleva sus conversaciones por delante y deja el audit log
// con referencias a un socio que ya no existe — justo el registro que sirve
// para saber quién autorizó qué campaña. Deshabilitar corta el acceso en el
// request siguiente y conserva la historia.
// ─────────────────────────────────────────────────────────────────────────

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' });

const PASSWORD_MIN = 8;

/** Qué puede hacer un rol, en palabras, para no tener que leer la tabla. */
function Permisos({ rol, roles }: { rol: Rol; roles: RolInfo[] }) {
  const info = roles.find((r) => r.value === rol);
  if (!info) return null;
  return <p className="usuarios-permisos">{info.descripcion}</p>;
}

function FilaUsuario({
  u,
  yo,
  roles,
  onCambiarRol,
  onCambiarHabilitado,
  onRestablecer,
}: {
  u: Usuario;
  yo: Partner;
  roles: RolInfo[];
  onCambiarRol: (id: string, role: Rol) => void;
  onCambiarHabilitado: (u: Usuario) => void;
  onRestablecer: (u: Usuario) => void;
}) {
  const esYo = u.id === yo.id;

  // Tres columnas alineadas entre filas (identidad · rol · acciones): a lo
  // ancho, una lista de tarjetas apiladas se lee como un montón de bloques
  // sueltos; en columnas se lee como una tabla y se compara de un vistazo.
  return (
    <li className={u.disabled ? 'usuarios-fila is-disabled' : 'usuarios-fila'}>
      <div className="usuarios-col-identidad">
        <span className="usuarios-nombre">
          {u.name}
          {esYo && <span className="usuarios-yo">tú</span>}
          {u.disabled && <span className="usuarios-chip-off">Sin acceso</span>}
        </span>
        <span className="usuarios-email">{u.email}</span>
        <Permisos rol={u.role} roles={roles} />
      </div>

      <div className="usuarios-col-rol">
        {/* El propio rol no se edita: el servidor lo rechaza igual, pero
            deshabilitarlo acá evita ofrecer una acción que va a fallar. */}
        <label className="usuarios-rol-label">
          <span className="sr-only">Rol de {u.name}</span>
          <select
            className="usuarios-rol"
            value={u.role}
            disabled={esYo}
            title={esYo ? 'No puedes cambiar tu propio rol.' : undefined}
            onChange={(e) => onCambiarRol(u.id, e.target.value as Rol)}
          >
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <span className="usuarios-alta">Alta el {fecha(u.createdAt)}</span>
      </div>

      <div className="usuarios-col-acciones">
        <button type="button" className="usuarios-accion" onClick={() => onRestablecer(u)}>
          Restablecer contraseña
        </button>
        <button
          type="button"
          className={u.disabled ? 'usuarios-accion is-habilitar' : 'usuarios-accion is-deshabilitar'}
          disabled={esYo && !u.disabled}
          title={esYo && !u.disabled ? 'No puedes deshabilitarte a ti mismo.' : undefined}
          onClick={() => onCambiarHabilitado(u)}
        >
          {u.disabled ? 'Habilitar' : 'Deshabilitar'}
        </button>
      </div>
    </li>
  );
}

function FormularioNuevo({
  abierto,
  cerrar,
  roles,
  onCrear,
}: {
  abierto: boolean;
  cerrar: () => void;
  roles: RolInfo[];
  onCrear: (d: { email: string; name: string; role: Rol; password: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Rol>('USER');
  const [password, setPassword] = useState('');
  const [guardando, setGuardando] = useState(false);

  const valido = name.trim() && email.trim().includes('@') && password.length >= PASSWORD_MIN;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido || guardando) return;
    setGuardando(true);
    try {
      await onCrear({ name: name.trim(), email: email.trim().toLowerCase(), role, password });
      setName('');
      setEmail('');
      setPassword('');
      setRole('USER');
      cerrar();
    } finally {
      setGuardando(false);
    }
  };

  if (!abierto) return null;

  return (
    <form className="usuarios-form" onSubmit={enviar}>
      <div className="usuarios-form-head">
        <h3 className="usuarios-form-titulo">Nuevo usuario</h3>
        <p className="usuarios-form-sub">Entra con el correo y la contraseña que le pongas acá.</p>
      </div>

      <div className="usuarios-form-grid">
        <label className="usuarios-campo">
          <span>Nombre</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Nombre y apellido" />
        </label>
        <label className="usuarios-campo">
          <span>Correo</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alguien@finzen.ai" type="email" />
        </label>
        <label className="usuarios-campo">
          <span>Rol</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Rol)}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="usuarios-campo">
          <span>Contraseña inicial</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder={`Mínimo ${PASSWORD_MIN} caracteres`}
          />
        </label>
      </div>

      {/* Las dos notas van lado a lado: con el formulario a lo ancho, apilarlas
          dejaba una columna de texto flaca contra medio metro de aire. */}
      <div className="usuarios-form-notas">
        <div className="usuarios-form-nota">
          <span className="usuarios-form-nota-tit">Qué podrá hacer</span>
          <Permisos rol={role} roles={roles} />
        </div>
        {/* Se dice en voz alta porque es una consecuencia real de no tener envío
            de correos: quien crea la cuenta conoce la contraseña hasta que la
            otra persona la cambie. */}
        <div className="usuarios-form-nota is-aviso">
          <span className="usuarios-form-nota-tit">Sobre la contraseña</span>
          <p className="usuarios-aviso">
            Tú vas a conocer esta contraseña. Pásasela por un medio privado y dile que la cambie al entrar, desde su
            propio menú.
          </p>
        </div>
      </div>

      <div className="usuarios-form-acciones">
        <button type="button" className="dialog-cancel" onClick={cerrar}>
          Cancelar
        </button>
        <button type="submit" className="dialog-confirm" disabled={!valido || guardando}>
          {guardando ? 'Creando…' : 'Crear usuario'}
        </button>
      </div>
    </form>
  );
}

export function UsuariosPage({ yo }: { yo: Partner }) {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [roles, setRoles] = useState<RolInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);

  const cargar = () =>
    Promise.all([api.listarUsuarios(), api.listarRoles()])
      .then(([u, r]) => {
        setUsuarios(u.usuarios);
        setRoles(r.roles);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los usuarios.'));

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Corre una acción y RECARGA desde el servidor: el estado que manda es el suyo. */
  const accion = async (fn: () => Promise<unknown>, exito: string) => {
    setError(null);
    setAviso(null);
    try {
      await fn();
      await cargar();
      setAviso(exito);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo completar la acción.');
    }
  };

  const cambiarRol = (id: string, role: Rol) => {
    const u = usuarios?.find((x) => x.id === id);
    void accion(() => api.actualizarUsuario(id, { role }), `Rol de ${u?.name ?? 'el usuario'} actualizado.`);
  };

  const cambiarHabilitado = (u: Usuario) =>
    void accion(
      () => api.cambiarHabilitado(u.id, !u.disabled),
      u.disabled ? `${u.name} vuelve a tener acceso.` : `${u.name} ya no tiene acceso.`,
    );

  const restablecer = (u: Usuario) => {
    const nueva = window.prompt(`Contraseña nueva para ${u.name} (mínimo ${PASSWORD_MIN} caracteres):`);
    if (nueva === null) return;
    if (nueva.length < PASSWORD_MIN) {
      setError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
      return;
    }
    void accion(() => api.restablecerPassword(u.id, nueva), `Contraseña de ${u.name} restablecida.`);
  };

  const crear = (d: { email: string; name: string; role: Rol; password: string }) =>
    accion(() => api.crearUsuario(d), `${d.name} ya puede entrar.`);

  if (!usuarios) {
    return <div className="audit-loading">{error ?? 'Cargando usuarios…'}</div>;
  }

  const sinAcceso = usuarios.filter((u) => u.disabled).length;

  return (
    <div className="usuarios-page">
      <header className="usuarios-header">
        <div className="usuarios-header-texto">
          <h2 className="usuarios-titulo">Usuarios</h2>
          <p className="usuarios-sub">
            Quién puede entrar a Kaizen y hasta dónde. Los permisos se aplican en el servidor: cambiar un rol tiene
            efecto en la petición siguiente, sin esperar a que la sesión caduque.
          </p>
        </div>
        <button
          type="button"
          className="usuarios-nuevo-btn"
          onClick={() => setNuevoAbierto((v) => !v)}
          aria-expanded={nuevoAbierto}
        >
          {nuevoAbierto ? 'Cerrar' : 'Agregar usuario'}
        </button>
      </header>

      {/* Fuera del header a propósito: adentro era un ítem más del flex y el
          formulario quedaba en una columna angosta al costado del título. */}
      <FormularioNuevo abierto={nuevoAbierto} cerrar={() => setNuevoAbierto(false)} roles={roles} onCrear={crear} />

      {error && <div className="banner-error">{error}</div>}
      {aviso && <p className="usuarios-ok">{aviso}</p>}

      <div className="usuarios-lista-head">
        <span className="usuarios-lista-conteo">
          {usuarios.length} {usuarios.length === 1 ? 'usuario' : 'usuarios'}
          {sinAcceso > 0 && ` · ${sinAcceso} sin acceso`}
        </span>
        <span className="usuarios-lista-col">Rol</span>
        <span className="usuarios-lista-col">Acciones</span>
      </div>

      <ul className="usuarios-lista">
        {usuarios.map((u) => (
          <FilaUsuario
            key={u.id}
            u={u}
            yo={yo}
            roles={roles}
            onCambiarRol={cambiarRol}
            onCambiarHabilitado={cambiarHabilitado}
            onRestablecer={restablecer}
          />
        ))}
      </ul>

      <p className="metas-nota">
        No se borran usuarios, se deshabilitan. Borrar a alguien se llevaría sus conversaciones y dejaría la
        auditoría sin poder decir quién autorizó cada campaña.
      </p>
    </div>
  );
}
