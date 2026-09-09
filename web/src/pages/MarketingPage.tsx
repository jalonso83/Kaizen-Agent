import { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// Apartado de Marketing (solo CEO / CTO — permiso 'marketing:ver').
//
// ⚠️ ESTO ES EL ESQUELETO. Nada está conectado todavía, a propósito: no hay
// endpoints, no hay tabla en la BD, no se guarda ni se lee nada. Lo que hay es
// la navegación, la estructura de las dos secciones y los campos dibujados,
// para poder decidir sobre algo concreto antes de construir el backend.
//
// Por eso la sección de Configuración avisa EN PANTALLA que todavía no
// persiste y el botón de guardar está deshabilitado. Un formulario que parece
// que guarda y no guarda es peor que uno que no existe: alguien escribe sus
// URLs, recarga, las pierde y no entiende por qué. Es el mismo patrón de fallo
// silencioso que ya mordió varias veces en este proyecto.
//
// Cuando se conecte hay que: definir dónde vive esta configuración (tabla
// propia o una fila única como WeeklySummaryConfig), agregar sus rutas con
// requirePermission('marketing:ver'), y quitar el aviso y el disabled de acá.
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
      'Las cuentas de Meta desde donde sale la publicidad pagada. Por ahora son enlaces de referencia: la lectura de datos de Meta va por la Graph API con su propio token, que se configura en las variables del servidor y nunca acá.',
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
    // Solo Instagram por ahora (decisión del socio, 2026-09-09). TikTok,
    // YouTube y LinkedIn quedan para después: cada red se lee distinto, y
    // dibujar campos para redes que nadie va a leer da la impresión de que
    // están soportadas.
    titulo: 'Instagram',
    descripcion:
      'El perfil que Kaizen va a leer. De la URL se saca el usuario, que es lo que necesita cualquier lectura de perfil; se acepta también el handle pelado (@finzenai).',
    campos: [
      {
        clave: 'instagramUrl',
        label: 'Perfil',
        placeholder: 'https://instagram.com/finzenai',
        ayuda: 'La URL del perfil, no la de una publicación ni un reel.',
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

function AvisoSinConectar({ que }: { que: string }) {
  return (
    <p className="marketing-aviso" role="status">
      <strong>Todavía no está conectado.</strong> {que}
    </p>
  );
}

function Configuracion() {
  // Estado local a propósito: no hay a dónde mandarlo todavía. Se pierde al
  // cambiar de pestaña, y el aviso de arriba lo dice para que no sorprenda.
  const [valores, setValores] = useState<Record<string, string>>({});

  const cambiar = (clave: string, valor: string) => setValores((v) => ({ ...v, [clave]: valor }));

  return (
    <section className="marketing-seccion" aria-labelledby="marketing-configuracion">
      <header className="marketing-seccion-head">
        <h3 className="marketing-seccion-titulo" id="marketing-configuracion">
          Configuración
        </h3>
        <p className="marketing-seccion-sub">
          Las cuentas y enlaces del negocio hacia afuera, en un solo lugar.
        </p>
      </header>

      <AvisoSinConectar que="Lo que escribas acá no se guarda: falta definir dónde vive esta configuración y construir el backend. Los campos son un punto de partida para decidir cuáles hacen falta de verdad." />

      {GRUPOS.map((grupo) => (
        <div className="marketing-grupo" key={grupo.titulo}>
          <div className="marketing-grupo-head">
            <h4 className="marketing-grupo-titulo">{grupo.titulo}</h4>
            <p className="marketing-grupo-sub">{grupo.descripcion}</p>
          </div>

          <div className="marketing-campos">
            {grupo.campos.map((campo) => (
              <label className="marketing-campo" key={campo.clave}>
                <span className="marketing-campo-label">{campo.label}</span>
                <input
                  type={campo.tipo === 'text' ? 'text' : 'url'}
                  value={valores[campo.clave] ?? ''}
                  placeholder={campo.placeholder}
                  onChange={(e) => cambiar(campo.clave, e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                {campo.ayuda && <span className="marketing-campo-ayuda">{campo.ayuda}</span>}
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="marketing-acciones">
        <button
          type="button"
          className="dialog-confirm"
          disabled
          title="Todavía no hay dónde guardarlo: falta el backend."
        >
          Guardar
        </button>
      </div>
    </section>
  );
}

function Dashboard() {
  return (
    <section className="marketing-seccion" aria-labelledby="marketing-dashboard">
      <header className="marketing-seccion-head">
        <h3 className="marketing-seccion-titulo" id="marketing-dashboard">
          Dashboard
        </h3>
        <p className="marketing-seccion-sub">Cómo va el marketing, de un vistazo.</p>
      </header>

      <AvisoSinConectar que="Falta definir qué va acá. El espacio está reservado y la navegación funciona; el contenido se decide antes de construirlo." />

      <div className="marketing-vacio">
        <p>Sin contenido todavía.</p>
      </div>
    </section>
  );
}

export function MarketingPage() {
  const [seccion, setSeccion] = useState<Seccion>('configuracion');

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

      {seccion === 'configuracion' ? <Configuracion /> : <Dashboard />}
    </div>
  );
}
