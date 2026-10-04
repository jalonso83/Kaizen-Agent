import { useState } from 'react';
import { api, ApiError } from '../api';
import type { ConversationSummary, MetaAdsConfig, MetaAdsVista, ObjetivoAnuncio } from '../types';
import { Select } from './Select';
import { OBJETIVO_LABEL } from './AdProposalCard';

// ─────────────────────────────────────────────────────────────────────────
// Configuración → Publicidad automática en Meta (2026-10-04).
//
// Todo lo que el modelo NO elige se fija acá: días y hora, presupuesto,
// duración, objetivo, destino y a quién. El presupuesto no puede pasar del
// tope de Railway (META_MAX_DAILY_BUDGET_USD): la pantalla lo muestra y el
// servidor lo valida igual. El estado vive en ConfigDialog, que lo guarda con
// el mismo botón Guardar — solo si se tocó algo (`sucio`): sin eso, abrir
// Configuración por primera vez fallaría al guardar un bloque a medio llenar.
// ─────────────────────────────────────────────────────────────────────────

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const HOUR12 = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
const MERIDIEM = [
  { value: 0, label: 'AM' },
  { value: 1, label: 'PM' },
];
const to12h = (h: number) => ({ hour12: h % 12 === 0 ? 12 : h % 12, meridiem: h < 12 ? 0 : 1 });
const to24h = (h12: number, m: number) => (m === 1 ? (h12 % 12) + 12 : h12 % 12);

export function configPorDefecto(tope: number): MetaAdsConfig {
  return {
    enabled: false,
    diasSemana: [1],
    cronHour: 9,
    conversationId: null,
    presupuestoDiario: Math.min(5, tope),
    duracionDias: 7,
    objetivo: 'OUTCOME_TRAFFIC',
    urlDestino: '',
    paises: ['DO'],
    edadMin: 18,
    edadMax: 65,
    categoriaFinanciera: false,
    rotacionDias: 30,
  };
}

interface Props {
  cfg: MetaAdsConfig;
  vista: MetaAdsVista;
  conversaciones: ConversationSummary[];
  onChange: (cfg: MetaAdsConfig) => void;
  deshabilitado: boolean;
}

export function MetaAdsConfigBlock({ cfg, vista, conversaciones, onChange, deshabilitado }: Props) {
  const [corriendo, setCorriendo] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [errorCorrida, setErrorCorrida] = useState<string | null>(null);
  const [paisesTexto, setPaisesTexto] = useState(cfg.paises.join(', '));
  const set = (cambios: Partial<MetaAdsConfig>) => onChange({ ...cfg, ...cambios });
  const convBorrada = Boolean(vista.config?.conversationId && !vista.conversacion && cfg.conversationId === vista.config.conversationId);

  const toggleDia = (d: number) => {
    const dias = cfg.diasSemana.includes(d) ? cfg.diasSemana.filter((x) => x !== d) : [...cfg.diasSemana, d].sort((a, b) => a - b);
    set({ diasSemana: dias });
  };

  const correrAhora = async () => {
    setCorriendo(true);
    setResultado(null);
    setErrorCorrida(null);
    try {
      const r = await api.runMetaAdsNow();
      const conv = conversaciones.find((c) => c.id === r.conversationId);
      setResultado(
        r.tarjeta
          ? `Listo — la tarjeta del anuncio quedó en "${conv?.title ?? r.conversationId}".`
          : `Kaizen corrió pero no propuso ningún post; explicó por qué en "${conv?.title ?? r.conversationId}".`,
      );
    } catch (err) {
      setErrorCorrida(err instanceof ApiError ? err.message : 'No se pudo correr la publicidad automática.');
    } finally {
      setCorriendo(false);
    }
  };

  const maximo = cfg.presupuestoDiario * cfg.duracionDias;

  return (
    <div className="config-schedule">
      {vista.falta && (
        <p className="config-error">Todavía no se puede crear nada en Meta: {vista.falta}.</p>
      )}
      <label className="config-check">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>
          <strong>Proponer un anuncio los días elegidos</strong> — Kaizen elige un post de Instagram de FinZen que rindió bien y deja la tarjeta en la conversación elegida.
          Al confirmarla se crea la campaña en Meta <strong>en pausa</strong>: no gasta hasta que alguien la active en Ads Manager.
        </span>
      </label>

      <div className="config-schedule-row">
        <div className="select-field">
          <span className="select-label">Días:</span>
          <div className="config-dias">
            {DIAS_CORTOS.map((d, i) => (
              <label key={d} className={`config-dia${cfg.diasSemana.includes(i) ? ' activo' : ''}`}>
                <input type="checkbox" checked={cfg.diasSemana.includes(i)} onChange={() => toggleDia(i)} />
                {d}
              </label>
            ))}
          </div>
        </div>
        <div className="select-field">
          <span className="select-label">Hora:</span>
          <div className="select-pair">
            <Select ariaLabel="Hora de la publicidad" compact value={to12h(cfg.cronHour).hour12} options={HOUR12} onChange={(h) => set({ cronHour: to24h(h, to12h(cfg.cronHour).meridiem) })} />
            <Select ariaLabel="AM o PM" compact value={to12h(cfg.cronHour).meridiem} options={MERIDIEM} onChange={(m) => set({ cronHour: to24h(to12h(cfg.cronHour).hour12, m) })} />
          </div>
        </div>
      </div>

      <div className="config-schedule-row">
        <label className="select-field">
          <span className="select-label">Presupuesto diario (USD):</span>
          <input
            className="config-native-select config-numero"
            type="number"
            min={1}
            max={vista.topeDiarioUsd}
            step={0.5}
            value={cfg.presupuestoDiario}
            onChange={(e) => set({ presupuestoDiario: Number(e.target.value) })}
          />
        </label>
        <Select
          label="Duración:"
          value={cfg.duracionDias}
          options={[3, 5, 7, 10, 14, 21, 30].map((d) => ({ value: d, label: `${d} días` }))}
          onChange={(d) => set({ duracionDias: d })}
        />
      </div>
      <p className="config-schedule-hint">
        Tope por campaña: <strong>{maximo.toLocaleString('es-DO', { maximumFractionDigits: 2 })} USD</strong> ({cfg.presupuestoDiario} × {cfg.duracionDias} días).
        El presupuesto diario no puede pasar de {vista.topeDiarioUsd} USD: ese tope se cambia en Railway (META_MAX_DAILY_BUDGET_USD), no desde acá.
      </p>

      <div className="config-schedule-row">
        <div className="select-field" style={{ flex: 1 }}>
          <span className="select-label">Objetivo:</span>
          <select className="config-native-select" value={cfg.objetivo} onChange={(e) => set({ objetivo: e.target.value as ObjetivoAnuncio })}>
            {(Object.keys(OBJETIVO_LABEL) as ObjetivoAnuncio[]).map((o) => (
              <option key={o} value={o}>{OBJETIVO_LABEL[o]}</option>
            ))}
          </select>
        </div>
      </div>
      {cfg.objetivo === 'OUTCOME_TRAFFIC' && (
        <div className="config-schedule-row">
          <label className="select-field" style={{ flex: 1 }}>
            <span className="select-label">A dónde lleva:</span>
            <input
              className="config-native-select"
              type="url"
              placeholder="https://… (la landing de FinZen)"
              value={cfg.urlDestino ?? ''}
              onChange={(e) => set({ urlDestino: e.target.value })}
            />
          </label>
        </div>
      )}

      <div className="config-schedule-row">
        <label className="select-field">
          <span className="select-label">Países:</span>
          <input
            className="config-native-select config-numero"
            value={paisesTexto}
            placeholder="DO"
            onChange={(e) => {
              setPaisesTexto(e.target.value);
              set({ paises: e.target.value.split(/[\s,]+/).map((p) => p.trim().toUpperCase()).filter(Boolean) });
            }}
          />
        </label>
        <label className="select-field">
          <span className="select-label">Edad:</span>
          <input className="config-native-select config-edad" type="number" min={18} max={65} disabled={cfg.categoriaFinanciera} value={cfg.categoriaFinanciera ? 18 : cfg.edadMin} onChange={(e) => set({ edadMin: Number(e.target.value) })} />
          <span>a</span>
          <input className="config-native-select config-edad" type="number" min={18} max={65} disabled={cfg.categoriaFinanciera} value={cfg.categoriaFinanciera ? 65 : cfg.edadMax} onChange={(e) => set({ edadMax: Number(e.target.value) })} />
        </label>
        <Select
          label="No repetir un post por:"
          value={cfg.rotacionDias}
          options={[14, 30, 60, 90].map((d) => ({ value: d, label: `${d} días` }))}
          onChange={(d) => set({ rotacionDias: d })}
        />
      </div>
      <label className="config-check">
        <input type="checkbox" checked={cfg.categoriaFinanciera} onChange={(e) => set({ categoriaFinanciera: e.target.checked })} />
        <span>
          <strong>Declarar categoría especial "productos y servicios financieros"</strong> — si FinZen debe declararla ante Meta, la edad queda fija en 18-65 y Meta limita la segmentación. Confirmalo con quien lleve lo legal.
        </span>
      </label>

      <div className="config-schedule-row">
        <div className="select-field" style={{ flex: 1 }}>
          <span className="select-label">Conversación donde cae la tarjeta:</span>
          <select className="config-native-select" value={cfg.conversationId ?? ''} onChange={(e) => set({ conversationId: e.target.value || null })}>
            <option value="">— elegir —</option>
            <option value="__nueva__">+ Nueva conversación (Kaizen la crea: "Publicidad en Meta")</option>
            {conversaciones.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
      </div>
      {convBorrada && <p className="config-error">La conversación que estaba elegida ya no existe. Elegí otra o creá una nueva.</p>}
      <p className="config-schedule-hint">
        Horario UTC-4. Las tarjetas también se pueden confirmar o rechazar desde Auditoría, y vencen a las 72 horas. Solo un CEO / CTO puede confirmarlas.
      </p>

      <div className="config-run-now">
        <button type="button" className="dialog-cancel" onClick={correrAhora} disabled={corriendo || deshabilitado}>
          {corriendo ? 'Generando…' : 'Proponer un anuncio ahora'}
        </button>
        <p className="config-run-now-hint">
          Corre la publicidad automática <strong>ahora</strong> con la configuración guardada, esté encendida o no. Guardá primero si cambiaste algo. No gasta nada: deja una tarjeta.
        </p>
        {resultado && <p className="config-run-now-ok">{resultado}</p>}
        {errorCorrida && <p className="config-error">{errorCorrida}</p>}
      </div>
    </div>
  );
}
