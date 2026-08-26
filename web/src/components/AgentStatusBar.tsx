interface Props {
  toolLabel: string | null;
  isStreaming: boolean;
  /** Corta la corrida. Aborta el fetch, y con él el turno del lado del server. */
  onStop: () => void;
}

/** "Kaizen está consultando KPIs…" — DISENO_FASE1.md §10, desde tool_start. */
export function AgentStatusBar({ toolLabel, isStreaming, onStop }: Props) {
  if (!isStreaming) return null;

  return (
    <div className="status-bar" role="status" aria-live="polite">
      <span className="status-bar-dot" aria-hidden="true" />
      <span className="status-bar-text">
        {toolLabel ? `Kaizen está ${toolLabel.toLowerCase()}` : 'Kaizen está pensando…'}
      </span>
      {/* El botón detiene de verdad: no solo deja de mostrar el texto, corta la
          corrida en el server. Lo que Kaizen alcanzó a escribir se guarda. */}
      <button type="button" className="status-bar-stop" onClick={onStop} title="Detener la respuesta">
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
          <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
        </svg>
        Detener
      </button>
    </div>
  );
}
