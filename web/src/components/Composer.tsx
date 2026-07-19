import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

interface Props {
  disabled: boolean;
  onSend: (text: string) => void;
}

/** Input del chat — deshabilitado mientras el agente responde (DISENO §10). */
export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState('');

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
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
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribile a Kaizen…"
        disabled={disabled}
        rows={1}
      />
      <button type="submit" className="primary" disabled={disabled || !text.trim()}>
        Enviar
      </button>
    </form>
  );
}
