import { useCallback, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// Consume el SSE de POST /api/conversations/:id/messages — DISENO_FASE1.md
// §10 ("~40 líneas, sin librerías"). fetch + response.body.getReader(), NO
// EventSource: la respuesta del POST ES el stream (decisión §0.4). Mismo
// parser ya probado en server/src/scripts/chatCli.ts.
//
// El texto y los tool calls en curso se acumulan en estado LOCAL de este
// hook (nunca se escriben en la lista de mensajes ya guardados); al recibir
// "done" se limpia y se avisa a onDone() para que el llamador recargue el
// historial real desde la BD — la fuente de verdad es siempre el server.
// ─────────────────────────────────────────────────────────────────────────

interface ToolStatus {
  name: string;
  label: string;
}

interface StreamState {
  isStreaming: boolean;
  liveText: string;
  toolStatus: ToolStatus | null;
  error: string | null;
}

const initialState: StreamState = { isStreaming: false, liveText: '', toolStatus: null, error: null };

export function useAgentStream(conversationId: string | null, onDone: () => void) {
  const [state, setState] = useState<StreamState>(initialState);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const sendMessage = useCallback(
    async (text: string) => {
      if (!conversationId || !text.trim()) return;
      setState({ isStreaming: true, liveText: '', toolStatus: null, error: null });

      let res: Response;
      try {
        res = await fetch(`/api/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text }),
        });
      } catch {
        setState((s) => ({ ...s, isStreaming: false, error: 'No se pudo conectar con Kaizen.' }));
        onDoneRef.current(); // el padre reconcilia (p.ej. saca el mensaje optimista)
        return;
      }

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}) as { message?: string });
        setState((s) => ({ ...s, isStreaming: false, error: body.message ?? `Error ${res.status}` }));
        onDoneRef.current();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const raw of chunks) {
          const eventLine = raw.split('\n').find((l) => l.startsWith('event:'));
          const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.slice(6).trim();
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }

          if (event === 'text_delta') {
            setState((s) => ({ ...s, liveText: s.liveText + String(data.text ?? '') }));
          } else if (event === 'tool_start') {
            setState((s) => ({
              ...s,
              toolStatus: { name: String(data.name ?? ''), label: String(data.label ?? 'Trabajando…') },
            }));
          } else if (event === 'tool_end') {
            setState((s) => ({ ...s, toolStatus: null }));
          } else if (event === 'run_error') {
            setState((s) => ({ ...s, error: String(data.message ?? 'Ocurrió un error.') }));
          }
          // message_done y done: el turno se cierra abajo, tras el while.
        }
      }

      // Preserva el error si el turno terminó con uno (p.ej. run_error) — antes
      // esto lo pisaba sin condición, así que el mensaje de error se borraba
      // solo un instante después de aparecer (bug real, encontrado 2026-07-19).
      setState((s) => ({ ...initialState, error: s.error }));
      onDoneRef.current();
    },
    [conversationId],
  );

  return { ...state, sendMessage };
}
