import { useEffect, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

interface Props {
  isStreaming: boolean;
  onSend: (text: string) => void;
  /** Corta la respuesta en curso. Reemplaza a Enviar mientras Kaizen trabaja. */
  onStop: () => void;
  /** Mensaje que se está editando: su texto se precarga acá (no en el chat). */
  editando: { id: string; texto: string } | null;
  onCancelarEdicion: () => void;
}

/**
 * Input del chat. Durante la respuesta el botón de Enviar SE CONVIERTE en
 * Detener: es el mismo lugar donde el socio ya tiene la mano, y evita que
 * convivan dos botones que hacen cosas opuestas.
 *
 * Editar un mensaje también pasa por acá y no por un textarea dentro de la
 * burbuja: el texto vuelve al mismo cuadro donde se escribió.
 */
export function Composer({ isStreaming, onSend, onStop, editando, onCancelarEdicion }: Props) {
  const [text, setText] = useState('');

  // Al empezar a editar, el texto del mensaje entra al cuadro; al cancelar o
  // terminar, se vacía. La dependencia es el id y no el objeto: así lo que el
  // socio esté reescribiendo no se pisa en cada render.
  useEffect(() => {
    setText(editando ? editando.texto : '');
  }, [editando?.id]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setText('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    // Escape cancela la edición, como en cualquier campo que edita algo.
    if (e.key === 'Escape' && editando) onCancelarEdicion();
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      {editando && (
        <div className="composer-editando">
          <span>Editando tu mensaje</span>
          <button type="button" onClick={onCancelarEdicion}>Cancelar</button>
        </div>
      )}
      <div className="composer-fila">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={editando ? 'Corrige tu mensaje…' : 'Escríbele a Kaizen…'}
          disabled={isStreaming}
          rows={1}
        />
        {isStreaming ? (
          <button type="button" className="composer-stop" onClick={onStop} title="Detener la respuesta">
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
              <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
            </svg>
            Detener
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!text.trim()}>
            {editando ? 'Guardar' : 'Enviar'}
          </button>
        )}
      </div>
    </form>
  );
}
