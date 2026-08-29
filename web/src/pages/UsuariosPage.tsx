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

  return (
    <li className={u.disabled ? 'usuarios-fila is-disabled' : 'usuarios-fila'}>
      <div className="usuarios-fila-head">
        <div className="usuarios-identidad">
          <span className="usuarios-nombre">
            {u.name}
            {esYo && <span className="usuarios-yo">tú</span>}
          </span>
          <span className="usuarios-email">{u.email}</span>
        </div>

        <div className="usuarios-controles">
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

          <button type="button" className="usuarios-accion" onClick={() => onRestablecer(u)}>
            Restablecer contraseña
          </button>

          <button
            type="button"
            className="usuarios-accion"
            disabled={esYo && !u.disabled}
            title={esYo && !u.disabled ? 'No puedes deshabilitarte a ti mismo.' : undefined}
            onClick={() => onCambiarHabilitado(u)}
          >
            {u.disabled ? 'Habilitar' : 'Deshabilitar'}
          </button>
        </div>
      </div>

      <Permisos rol={u.role} roles={roles} />
      <p className="usuarios-alta">
        {u.disabled && <span className="usuarios-estado-off">Sin acceso · </span>}
        Dado de alta el {fecha(u.createdAt)}
      </p>
    </li>
  );
}

function FormularioNuevo({ roles, onCrear }: { roles: RolInfo[]; onCrear: (d: { email: string; name: string; role: Rol; password: string }) => Promise<void> }) {
  const [abierto, setAbierto] = useState(false);
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
      setAbierto(false);
    } finally {
      setGuardando(false);
    }
  };

  if (!abierto) {
    return (
      <button type="button" className="usuarios-nuevo-btn" onClick={() => setAbierto(true)}>
        Agregar usuario
      </button>
    );
  }

  return (
    <form className="usuarios-form" onSubmit={enviar}>
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

      <Permisos rol={role} roles={roles} />

      {/* Se dice en voz alta porque es una consecuencia real de no tener envío
          de correos: quien crea la cuenta conoce la contraseña hasta que la
          otra persona la cambie. */}
      <p className="usuarios-aviso">
        Tú vas a conocer esta contraseña. Pásasela por un medio privado y dile que la cambie al entrar, desde su
        propio menú.
      </p>

      <div className="usuarios-form-acciones">
        <button type="button" className="dialog-cancel" onClick={() => setAbierto(false)}>
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

  return (
    <div className="usuarios-page">
      <header className="usuarios-header">
        <div>
          <h2 className="usuarios-titulo">Usuarios</h2>
          <p className="usuarios-sub">
            Quién puede entrar a Kaizen y hasta dónde. Los permisos se aplican en el servidor: cambiar un rol tiene
            efecto en la petición siguiente, sin esperar a que la sesión caduque.
          </p>
        </div>
        <FormularioNuevo roles={roles} onCrear={crear} />
      </header>

      {error && <div className="banner-error">{error}</div>}
      {aviso && <p className="usuarios-ok">{aviso}</p>}

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
