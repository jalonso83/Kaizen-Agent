interface Props {
  toolLabel: string | null;
  isStreaming: boolean;
}

/** "Kaizen está consultando KPIs…" — DISENO_FASE1.md §10, desde tool_start. */
export function AgentStatusBar({ toolLabel, isStreaming }: Props) {
  if (!isStreaming) return null;

  return (
    <div className="status-bar" role="status" aria-live="polite">
      <span className="status-bar-dot" aria-hidden="true" />
      {toolLabel ? `Kaizen está ${toolLabel.toLowerCase()}` : 'Kaizen está pensando…'}
    </div>
  );
}
