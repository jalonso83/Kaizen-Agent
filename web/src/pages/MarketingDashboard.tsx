import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { AnalisisInstagram, CuentaMarketing, InsightsInstagram } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// Dashboard de Marketing — la lectura de las cuentas de redes.
//
// Muestra EXACTAMENTE lo que devuelve /api/marketing/instagram/:usuario, que
// es lo mismo que lee Kaizen con get_instagram_profile (un solo análisis,
// services/instagramAnalisis.ts). Acá no se calcula ningún número: si un
// promedio o una tasa se ve raro, el lugar donde mirar es el servidor, y lo
// que se arregle ahí se arregla para el chat también.
//
// Por ahora solo Instagram. La estructura (una cuenta seleccionada, tarjetas
// de cifras, insights si es la propia, top de piezas) es la misma que va a
// necesitar TikTok cuando tenga fuente; lo que cambia son las métricas.
// ─────────────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('es-DO');
const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : fmt.format(n));
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-DO', { maximumFractionDigits: 2 })} %`);
const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dia = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });

/** Etiquetas legibles de las métricas de insights, en el orden en que se muestran. */
const INSIGHTS: Array<{ clave: keyof InsightsInstagram['totales']; label: string; ayuda: string }> = [
  { clave: 'reach', label: 'Alcance', ayuda: 'Cuentas distintas que vieron algo de la cuenta.' },
  { clave: 'views', label: 'Views', ayuda: 'Veces que se vio contenido (reemplaza a impresiones).' },
  { clave: 'accounts_engaged', label: 'Cuentas que interactuaron', ayuda: 'Cuentas distintas con al menos una interacción.' },
  { clave: 'total_interactions', label: 'Interacciones', ayuda: 'Likes + comentarios + guardados + compartidos + respuestas.' },
  { clave: 'likes', label: 'Likes', ayuda: '' },
  { clave: 'comments', label: 'Comentarios', ayuda: '' },
  { clave: 'saves', label: 'Guardados', ayuda: 'La señal más fuerte de que el contenido vale: lo guardan para volver.' },
  { clave: 'shares', label: 'Compartidos', ayuda: '' },
  { clave: 'profile_links_taps', label: 'Taps al link', ayuda: 'Toques en el enlace de la bio — el puente hacia registros.' },
  { clave: 'follows_and_unfollows', label: 'Altas y bajas', ayuda: 'Seguidores ganados y perdidos en la ventana.' },
];

function Tarjeta({ label, valor, ayuda, destacada }: { label: string; valor: string; ayuda?: string; destacada?: boolean }) {
  return (
    <div className={destacada ? 'mkd-tarjeta is-destacada' : 'mkd-tarjeta'}>
      <span className="mkd-tarjeta-label">{label}</span>
      <span className="mkd-tarjeta-valor">{valor}</span>
      {ayuda && <span className="mkd-tarjeta-ayuda">{ayuda}</span>}
    </div>
  );
}

/** Barras por día, sin librería: son 28 valores y una altura. */
function SeguidoresPorDia({ serie }: { serie: InsightsInstagram['seguidores_por_dia'] }) {
  if (serie.length === 0) return null;
  const max = Math.max(...serie.map((s) => Math.abs(s.valor)), 1);
  const total = serie.reduce((a, s) => a + s.valor, 0);
  return (
    <div className="mkd-serie">
      <div className="mkd-serie-head">
        <span className="mkd-tarjeta-label">Seguidores nuevos por día</span>
        <span className="mkd-serie-total">{total >= 0 ? '+' : ''}{num(total)} en la ventana</span>
      </div>
      <div className="mkd-barras" role="img" aria-label={`Seguidores nuevos por día, ${serie.length} días`}>
        {serie.map((s) => (
          <div
            key={s.fecha}
            className={s.valor < 0 ? 'mkd-barra is-negativa' : 'mkd-barra'}
            style={{ height: `${Math.max((Math.abs(s.valor) / max) * 100, 2)}%` }}
            title={`${dia(s.fecha)}: ${s.valor >= 0 ? '+' : ''}${num(s.valor)}`}
          />
        ))}
      </div>
      <div className="mkd-barras-ejes">
        <span>{dia(serie[0].fecha)}</span>
        <span>{dia(serie[serie.length - 1].fecha)}</span>
      </div>
    </div>
  );
}

function Insights({ insights }: { insights: InsightsInstagram }) {
  const hay = INSIGHTS.filter((m) => insights.totales[m.clave] !== undefined);
  return (
    <div className="marketing-grupo">
      <div className="marketing-grupo-head">
        <h4 className="marketing-grupo-titulo">
          Insights de la cuenta
          {insights.ventana.dias > 0 && (
            <span className="mkd-ventana"> · últimos {insights.ventana.dias} días ({dia(insights.ventana.desde)} – {dia(insights.ventana.hasta)})</span>
          )}
        </h4>
        <p className="marketing-grupo-sub">
          Lo que solo se puede ver de la cuenta propia. Esto es lo que decide: alcance, guardados y taps al link son el
          funnel; likes y comentarios son el pulso.
        </p>
      </div>

      {hay.length > 0 && (
        <div className="mkd-tarjetas">
          {hay.map((m) => (
            <Tarjeta key={m.clave} label={m.label} valor={num(insights.totales[m.clave])} ayuda={m.ayuda || undefined} />
          ))}
        </div>
      )}

      <SeguidoresPorDia serie={insights.seguidores_por_dia} />

      {insights.no_disponible.length > 0 && (
        <div className="marketing-aviso" role="status">
          <strong>Parte de los insights no llegó.</strong>
          <ul className="mkd-lista-motivos">
            {insights.no_disponible.map((n, i) => (
              <li key={i}>
                <code>{n.metricas.join(', ')}</code>: {n.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AnalisisInstagramVista({ a }: { a: AnalisisInstagram }) {
  const r = a.resumen_publicaciones;
  return (
    <>
      <div className="mkd-perfil">
        <div className="mkd-perfil-datos">
          <span className="mkd-perfil-nombre">
            {a.perfil.nombre || `@${a.cuenta.usuario}`}
            {a.cuenta.es_de_finzen && <span className="marketing-chip-propia">FinZen</span>}
          </span>
          <a className="marketing-cuenta-url" href={a.cuenta.url} target="_blank" rel="noreferrer noopener">
            @{a.cuenta.usuario}
          </a>
          {a.perfil.biografia && <p className="mkd-perfil-bio">{a.perfil.biografia}</p>}
          {a.perfil.sitio_web && (
            <a className="marketing-cuenta-url" href={a.perfil.sitio_web} target="_blank" rel="noreferrer noopener">
              {a.perfil.sitio_web}
            </a>
          )}
        </div>
        <span className="mkd-leido">
          Leído {fecha(a.leido_en)}
          {a.desde_cache && ' (caché)'}
        </span>
      </div>

      <div className="mkd-tarjetas">
        <Tarjeta label="Seguidores" valor={num(a.perfil.seguidores)} destacada />
        <Tarjeta label="Seguidos" valor={num(a.perfil.seguidos)} ayuda={a.perfil.ratio_seguidores_seguidos !== null ? `${num(a.perfil.ratio_seguidores_seguidos)} seguidores por cada seguido` : undefined} />
        <Tarjeta label="Publicaciones" valor={num(a.perfil.publicaciones_totales)} ayuda={r.piezas_por_semana !== null ? `${num(r.piezas_por_semana)} por semana, últimas ${r.cantidad}` : undefined} />
        <Tarjeta
          label="Tasa de engagement"
          valor={pct(a.tasa_engagement_pct)}
          ayuda="Interacciones promedio por pieza sobre seguidores."
          destacada
        />
      </div>

      <div className="marketing-grupo">
        <div className="marketing-grupo-head">
          <h4 className="marketing-grupo-titulo">
            Últimas {r.cantidad} publicaciones
            {r.desde && r.hasta && <span className="mkd-ventana"> · {dia(r.desde)} – {dia(r.hasta)}</span>}
          </h4>
          <p className="marketing-grupo-sub">
            Likes y comentarios son lo público. Contextualizan qué llamó la atención; no dicen qué funcionó — para eso
            están los insights.
          </p>
        </div>

        <div className="mkd-tarjetas">
          <Tarjeta label="Interacciones" valor={num(r.interacciones_total)} ayuda={`${num(r.likes_total)} likes · ${num(r.comentarios_total)} comentarios`} />
          <Tarjeta label="Por pieza (promedio)" valor={num(r.interacciones_promedio)} ayuda={`${num(r.likes_promedio)} likes · ${num(r.comentarios_promedio)} comentarios`} />
          <Tarjeta label="Likes (mediana)" valor={num(r.likes_mediana)} ayuda="Con una pieza viral el promedio miente; la mediana no." />
        </div>

        {r.por_tipo.length > 0 && (
          <table className="mkd-tabla">
            <thead>
              <tr>
                <th>Tipo</th>
                <th className="is-num">Piezas</th>
                <th className="is-num">Likes prom.</th>
                <th className="is-num">Interacciones prom.</th>
              </tr>
            </thead>
            <tbody>
              {r.por_tipo.map((t) => (
                <tr key={t.tipo}>
                  <td>{t.tipo}</td>
                  <td className="is-num">{num(t.cantidad)}</td>
                  <td className="is-num">{num(t.likes_promedio)}</td>
                  <td className="is-num">{num(t.interacciones_promedio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {r.top.length > 0 && (
          <>
            <h5 className="mkd-subtitulo">Las que más interacciones tuvieron</h5>
            <ol className="mkd-top">
              {r.top.map((t) => (
                <li key={t.permalink} className="mkd-top-item">
                  <div className="mkd-top-datos">
                    <a href={t.permalink} target="_blank" rel="noreferrer noopener" className="mkd-top-caption">
                      {t.caption_inicio || '(sin texto)'}
                    </a>
                    <span className="marketing-campo-ayuda">
                      {t.tipo} · {dia(t.fecha)}
                    </span>
                  </div>
                  <span className="mkd-top-cifras">
                    <strong>{num(t.interacciones)}</strong> · {num(t.likes)} likes · {num(t.comentarios)} com.
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      {a.insights && <Insights insights={a.insights} />}
    </>
  );
}

export function MarketingDashboard() {
  const [cuentas, setCuentas] = useState<CuentaMarketing[] | null>(null);
  const [usuario, setUsuario] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<AnalisisInstagram | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listarCuentasMarketing()
      .then((r) => {
        setCuentas(r.cuentas);
        // La de FinZen primero (el servidor ya la ordena así); si no hay, la primera.
        setUsuario(r.cuentas[0]?.usuario ?? null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las cuentas.'));
  }, []);

  const leer = (u: string, refresh = false) => {
    setCargando(true);
    setError(null);
    api
      .leerInstagram(u, refresh)
      .then(setAnalisis)
      .catch((e) => {
        setAnalisis(null);
        setError(e instanceof ApiError ? e.message : 'No se pudo leer el perfil.');
      })
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    if (usuario) leer(usuario);
  }, [usuario]);

  return (
    <section className="marketing-seccion" aria-labelledby="marketing-dashboard">
      <header className="marketing-seccion-head">
        <h3 className="marketing-seccion-titulo" id="marketing-dashboard">
          Dashboard
        </h3>
        <p className="marketing-seccion-sub">
          Cómo van las cuentas de redes. Los mismos números que Kaizen lee por chat.
        </p>
      </header>

      {cuentas !== null && cuentas.length === 0 && (
        <div className="marketing-vacio">
          <p>No hay perfiles guardados. Agregá el de FinZen en Configuración → Perfiles y aparece acá.</p>
        </div>
      )}

      {cuentas && cuentas.length > 0 && (
        <div className="mkd-barra-cuentas">
          <div className="mkd-cuentas" role="tablist" aria-label="Cuenta">
            {cuentas.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.usuario === usuario}
                className={c.usuario === usuario ? 'marketing-subtab is-active' : 'marketing-subtab'}
                onClick={() => setUsuario(c.usuario)}
              >
                {c.etiqueta || `@${c.usuario}`}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="usuarios-accion"
            disabled={!usuario || cargando}
            onClick={() => usuario && leer(usuario, true)}
            title="Vuelve a consultar a Instagram, saltando la caché de 10 minutos."
          >
            {cargando ? 'Leyendo…' : 'Recargar'}
          </button>
        </div>
      )}

      {error && <div className="banner-error">{error}</div>}

      {cargando && !analisis && (
        <div className="marketing-vacio">
          <p>Leyendo el perfil…</p>
        </div>
      )}

      {analisis && <AnalisisInstagramVista a={analisis} />}
    </section>
  );
}
