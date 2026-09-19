import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { CuentaMarketing, Partner } from '../types';
import { MarketingDashboard } from './MarketingDashboard';

// ─────────────────────────────────────────────────────────────────────────
// Apartado de Marketing (solo CEO / CTO — permisos 'marketing:ver' para
// mirarlo y 'marketing:editar' para cambiar las cuentas).
//
// ESTADO: todo persiste. Los PERFILES (tabla MarketingAccount,
// /api/marketing/accounts), los ENLACES de referencia (MarketingLink,
// /api/marketing/links) y el DASHBOARD lee Instagram de verdad
// (MarketingDashboard.tsx, /api/marketing/instagram/:usuario).
//
// Esa distinción se mantiene visible a propósito: mezclar campos que guardan
// con campos que no, sin decir cuál es cuál, es la forma más rápida de que
// alguien escriba algo, recargue y lo pierda sin entender por qué.
// ─────────────────────────────────────────────────────────────────────────

type Seccion = 'configuracion' | 'dashboard';

const SECCIONES: Array<{ id: Seccion; label: string }> = [
  { id: 'configuracion', label: 'Configuración' },
  { id: 'dashboard', label: 'Dashboard' },
];

/**
 * Los campos de la configuración, declarados como datos y no como JSX suelto:
 * agregar, quitar o reordenar uno es tocar esta lista, que es lo que va a pasar
 * varias veces mientras se decide qué va acá.
 *
 * Son un PUNTO DE PARTIDA, no la lista definitiva.
 */
interface CampoConfig {
  clave: string;
  label: string;
  ayuda?: string;
  placeholder: string;
  tipo?: 'url' | 'text';
}

interface GrupoConfig {
  titulo: string;
  descripcion: string;
  campos: CampoConfig[];
}

const GRUPOS: GrupoConfig[] = [
  {
    titulo: 'Meta',
    descripcion:
      'Las cuentas de Meta desde donde sale la publicidad pagada. Son enlaces de referencia: la lectura de datos de Meta va por la Graph API con su propio token, que se configura en las variables del servidor y nunca acá.',
    campos: [
      {
        clave: 'metaBusinessUrl',
        label: 'Business Manager',
        placeholder: 'https://business.facebook.com/...',
        ayuda: 'El panel del negocio, para abrirlo desde acá.',
      },
      {
        clave: 'metaAdsUrl',
        label: 'Administrador de anuncios',
        placeholder: 'https://adsmanager.facebook.com/...',
      },
      {
        clave: 'metaPaginaUrl',
        label: 'Página de Facebook',
        placeholder: 'https://facebook.com/finzenai',
      },
    ],
  },
  {
    titulo: 'Sitio y aplicación',
    descripcion: 'A dónde se manda el tráfico. Sirve para revisar que los enlaces de las campañas apunten a donde deben.',
    campos: [
      { clave: 'landingUrl', label: 'Landing', placeholder: 'https://finzenai.com' },
      { clave: 'appStoreUrl', label: 'App Store', placeholder: 'https://apps.apple.com/...' },
      { clave: 'playStoreUrl', label: 'Google Play', placeholder: 'https://play.google.com/...' },
    ],
  },
];

/**
 * Los perfiles sociales que Kaizen puede leer. Esta sección SÍ persiste.
 *
 * La URL se manda tal cual se escribió: el servidor deriva el usuario y la URL
 * canónica. Por eso lo que se ve en la lista después de guardar puede no ser
 * literalmente lo que se tipeó — y está bien, es la forma normalizada.
 */
function Perfiles({ puedeEditar }: { puedeEditar: boolean }) {
  const [cuentas, setCuentas] = useState<CuentaMarketing[] | null>(null);
  const [red, setRed] = useState<'INSTAGRAM' | 'TIKTOK'>('INSTAGRAM');
  const [url, setUrl] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [esPropia, setEsPropia] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = () =>
    api
      .listarCuentasMarketing()
      .then((r) => setCuentas(r.cuentas))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las cuentas.'));

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Corre una acción y RECARGA del servidor: el estado que manda es el suyo. */
  const accion = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await cargar();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo completar la acción.');
      return false;
    }
  };

  const agregar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || guardando) return;
    setGuardando(true);
    try {
      const ok = await accion(() =>
        api.agregarCuentaMarketing({ red, url: url.trim(), etiqueta: etiqueta.trim() || undefined, esPropia }),
      );
      if (ok) {
        setUrl('');
        setEtiqueta('');
        setEsPropia(false);
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="marketing-seccion" aria-labelledby="marketing-perfiles">
      <header className="marketing-seccion-head">
        <h3 className="marketing-seccion-titulo" id="marketing-perfiles">
          Perfiles
        </h3>
        <p className="marketing-seccion-sub">
          Las cuentas que Kaizen puede leer. Instagram (propias y de terceros) y TikTok (solo la cuenta de FinZen: su API no lee perfiles ajenos).
        </p>
      </header>

      {error && <div className="banner-error">{error}</div>}

      {puedeEditar && (
        <form className="marketing-grupo" onSubmit={agregar}>
          <div className="marketing-grupo-head">
            <h4 className="marketing-grupo-titulo">Agregar un perfil</h4>
            <p className="marketing-grupo-sub">
              Pegá la URL del perfil (no la de una publicación ni un video); también vale el handle,{' '}
              <code>@finzenai</code>. De ahí se saca el usuario, que es lo que necesita la API.
            </p>
          </div>

          <div className="marketing-campos">
            <label className="marketing-campo">
              <span className="marketing-campo-label">Red</span>
              <select value={red} onChange={(e) => setRed(e.target.value as 'INSTAGRAM' | 'TIKTOK')}>
                <option value="INSTAGRAM">Instagram</option>
                <option value="TIKTOK">TikTok</option>
              </select>
            </label>
            <label className="marketing-campo">
              <span className="marketing-campo-label">URL o handle</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={red === 'TIKTOK' ? 'https://www.tiktok.com/@finzenai' : 'https://instagram.com/finzenai'}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="marketing-campo">
              <span className="marketing-campo-label">Etiqueta (opcional)</span>
              <input
                value={etiqueta}
                onChange={(e) => setEtiqueta(e.target.value)}
                placeholder="FinZen, Competidor X…"
                autoComplete="off"
              />
              <span className="marketing-campo-ayuda">Cómo llamarlo en pantalla. Si se deja vacío se muestra el usuario.</span>
            </label>
          </div>

          <label className="marketing-check">
            <input type="checkbox" checked={esPropia} onChange={(e) => setEsPropia(e.target.checked)} />
            <span>
              Es la cuenta de FinZen
              {/* No es cosmético: de la cuenta propia se pueden pedir alcance y
                  guardados; de un tercero, nunca. */}
              <span className="marketing-campo-ayuda">
                {red === 'TIKTOK'
                  ? 'En TikTok solo la cuenta propia se puede leer; un tercero queda guardado como referencia, sin datos.'
                  : 'Solo de la cuenta propia se pueden obtener alcance y guardados. De un tercero, solo lo público.'}
              </span>
            </span>
          </label>

          <div className="marketing-acciones">
            <button type="submit" className="dialog-confirm" disabled={!url.trim() || guardando}>
              {guardando ? 'Guardando…' : 'Agregar'}
            </button>
          </div>
        </form>
      )}

      {cuentas === null ? (
        <div className="marketing-vacio">
          <p>Cargando…</p>
        </div>
      ) : cuentas.length === 0 ? (
        <div className="marketing-vacio">
          <p>Todavía no hay perfiles guardados.</p>
        </div>
      ) : (
        <ul className="marketing-lista">
          {cuentas.map((c) => (
            <li className="marketing-cuenta" key={c.id}>
              <div className="marketing-cuenta-datos">
                <span className="marketing-cuenta-nombre">
                  <span className="marketing-chip-red">{c.red === 'TIKTOK' ? 'TikTok' : 'Instagram'}</span>
                  {c.etiqueta || `@${c.usuario}`}
                  {c.esPropia && <span className="marketing-chip-propia">FinZen</span>}
                </span>
                <a className="marketing-cuenta-url" href={c.url} target="_blank" rel="noreferrer noopener">
                  {c.url}
                </a>
                {c.etiqueta && <span className="marketing-campo-ayuda">@{c.usuario}</span>}
              </div>

              {puedeEditar && (
                <div className="marketing-cuenta-acciones">
                  {!c.esPropia && (
                    <button
                      type="button"
                      className="usuarios-accion"
                      title="Marcarla como la cuenta de FinZen. La que estuviera marcada deja de estarlo."
                      onClick={() => void accion(() => api.editarCuentaMarketing(c.id, { esPropia: true }))}
                    >
                      Es de FinZen
                    </button>
                  )}
                  <button
                    type="button"
                    className="usuarios-accion is-deshabilitar"
                    onClick={() => void accion(() => api.borrarCuentaMarketing(c.id))}
                  >
                    Quitar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * La autorización de TikTok (Login Kit), una sola vez. Kaizen manda al socio
 * a TikTok, TikTok vuelve al callback del servidor, y el token queda guardado
 * en la BD. El resultado llega por la URL (/?tiktok=ok|error&motivo=…).
 */
function ConexionTiktok({ puedeEditar }: { puedeEditar: boolean }) {
  const [estado, setEstado] = useState<Awaited<ReturnType<typeof api.estadoTiktok>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yendo, setYendo] = useState(false);
  const resultado = (() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has('tiktok')) return null;
    return { ok: q.get('tiktok') === 'ok', motivo: q.get('motivo') };
  })();

  useEffect(() => {
    api.estadoTiktok().then(setEstado).catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo consultar TikTok.'));
    // Limpiar la query para que un F5 no repita el aviso.
    if (resultado) window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const conectar = async () => {
    setYendo(true);
    setError(null);
    try {
      const { url } = await api.autorizarTiktok();
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo iniciar la autorización.');
      setYendo(false);
    }
  };

  const vence = estado?.refreshVenceEn ? new Date(estado.refreshVenceEn).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="marketing-grupo">
      <div className="marketing-grupo-head">
        <h4 className="marketing-grupo-titulo">Conexión con TikTok</h4>
        <p className="marketing-grupo-sub">
          TikTok solo deja leer la cuenta que autorizó a Kaizen. La autorización se hace una vez, con la cuenta de FinZen, y
          Kaizen renueva el acceso solo (el permiso dura un año; después se vuelve a conectar).
        </p>
      </div>

      {resultado && (
        <p className={resultado.ok ? 'marketing-aviso is-ok' : 'marketing-aviso'} role="status">
          {resultado.ok ? <strong>TikTok quedó conectado.</strong> : <><strong>No se pudo conectar.</strong> {resultado.motivo}</>}
        </p>
      )}
      {error && <div className="banner-error">{error}</div>}

      {estado && !estado.appConfigurada && (
        <p className="marketing-aviso" role="status">
          <strong>Falta la app de TikTok en el servidor.</strong> Quien administra Railway tiene que cargar{' '}
          <code>TIKTOK_CLIENT_KEY</code> y <code>TIKTOK_CLIENT_SECRET</code>, y en developers.tiktok.com registrar esta URL de
          redirección: <code>{estado.redirectUri}</code>
        </p>
      )}

      {estado && estado.appConfigurada && (
        <div className="marketing-acciones" style={{ justifyContent: 'space-between' }}>
          <span className="marketing-campo-ayuda">
            {estado.conectada
              ? `Conectada${estado.openId ? ` (open_id ${estado.openId.slice(0, 8)}…)` : ''}${vence ? ` · el permiso vence el ${vence}` : ''}${estado.fuente === 'variable' ? ' · token cargado por variable' : ''}`
              : 'Todavía no está conectada.'}
          </span>
          {puedeEditar && (
            <button type="button" className="dialog-confirm" onClick={() => void conectar()} disabled={yendo}>
              {yendo ? 'Abriendo TikTok…' : estado.conectada ? 'Volver a conectar' : 'Conectar TikTok'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Configuracion({ puedeEditar }: { puedeEditar: boolean }) {
  // Lo guardado en el servidor y lo que se está editando, por separado: así
  // "Guardar" se habilita solo cuando hay un cambio real, y "Descartar" vuelve
  // a lo del servidor sin recargar.
  const [guardado, setGuardado] = useState<Record<string, string> | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    api
      .leerEnlacesMarketing()
      .then((r) => {
        setGuardado(r.links);
        setValores(r.links);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudieron cargar los enlaces.'));
  }, []);

  const cambiar = (clave: string, valor: string) => {
    setOk(false);
    setValores((v) => ({ ...v, [clave]: valor }));
  };

  const claves = GRUPOS.flatMap((g) => g.campos.map((c) => c.clave));
  const hayCambios = guardado !== null && claves.some((k) => (valores[k] ?? '').trim() !== (guardado[k] ?? ''));

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      // Se manda el mapa completo con todas las claves conocidas: una vacía
      // borra la fila en el servidor.
      const r = await api.guardarEnlacesMarketing(Object.fromEntries(claves.map((k) => [k, (valores[k] ?? '').trim()])));
      setGuardado(r.links);
      setValores(r.links);
      setOk(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron guardar los enlaces.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      {/* Los perfiles van primero porque son lo que de verdad usa Kaizen; los
          enlaces son para abrir a mano. */}
      <Perfiles puedeEditar={puedeEditar} />

      <ConexionTiktok puedeEditar={puedeEditar} />

      <section className="marketing-seccion" aria-labelledby="marketing-configuracion">
      <header className="marketing-seccion-head">
        <h3 className="marketing-seccion-titulo" id="marketing-configuracion">
          Enlaces de referencia
        </h3>
        <p className="marketing-seccion-sub">
          Accesos rápidos a las cuentas y al sitio. Kaizen no los lee: son para abrirlos a mano.
        </p>
      </header>

      {error && <div className="banner-error">{error}</div>}

      {GRUPOS.map((grupo) => (
        <div className="marketing-grupo" key={grupo.titulo}>
          <div className="marketing-grupo-head">
            <h4 className="marketing-grupo-titulo">{grupo.titulo}</h4>
            <p className="marketing-grupo-sub">{grupo.descripcion}</p>
          </div>

          <div className="marketing-campos">
            {grupo.campos.map((campo) => {
              const valor = valores[campo.clave] ?? '';
              const abrible = (guardado?.[campo.clave] ?? '') === valor.trim() && valor.trim() !== '';
              return (
                <label className="marketing-campo" key={campo.clave}>
                  <span className="marketing-campo-label">
                    {campo.label}
                    {abrible && (
                      <>
                        {' · '}
                        <a className="marketing-cuenta-url" href={valor.trim()} target="_blank" rel="noreferrer noopener">
                          abrir
                        </a>
                      </>
                    )}
                  </span>
                  <input
                    type={campo.tipo === 'text' ? 'text' : 'url'}
                    value={valor}
                    placeholder={campo.placeholder}
                    onChange={(e) => cambiar(campo.clave, e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!puedeEditar || guardado === null}
                  />
                  {campo.ayuda && <span className="marketing-campo-ayuda">{campo.ayuda}</span>}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {puedeEditar && (
        <div className="marketing-acciones">
          {ok && !hayCambios && <span className="marketing-campo-ayuda">Guardado.</span>}
          {hayCambios && (
            <button type="button" className="usuarios-accion" onClick={() => { setValores(guardado ?? {}); setOk(false); }} disabled={guardando}>
              Descartar
            </button>
          )}
          <button type="button" className="dialog-confirm" disabled={!hayCambios || guardando} onClick={() => void guardar()}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}
      </section>
    </>
  );
}

export function MarketingPage({ yo }: { yo: Partner }) {
  const [seccion, setSeccion] = useState<Seccion>('configuracion');
  // Esconder los controles de edición es cortesía: el servidor niega igual con
  // 403 si alguien llama la API a mano (requirePermission('marketing:editar')).
  const puedeEditar = yo.permisos.includes('marketing:editar');

  return (
    <div className="marketing-page">
      <header className="marketing-header">
        <h2 className="marketing-titulo">Marketing</h2>
        <p className="marketing-sub">
          Las cuentas del negocio hacia afuera y cómo van. Solo CEO / CTO — el servidor lo verifica en cada petición, no
          alcanza con esconder la pestaña.
        </p>
      </header>

      {/* Sub-navegación propia, no pestañas de la barra superior: son dos caras
          de un mismo apartado, no dos apartados. */}
      <nav className="marketing-subnav" aria-label="Secciones de marketing">
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={seccion === s.id ? 'marketing-subtab is-active' : 'marketing-subtab'}
            onClick={() => setSeccion(s.id)}
            aria-current={seccion === s.id ? 'page' : undefined}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {seccion === 'configuracion' ? <Configuracion puedeEditar={puedeEditar} /> : <MarketingDashboard />}
    </div>
  );
}
