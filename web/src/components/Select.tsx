import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// Desplegable propio (botón + lista absoluta) en reemplazo de <select>.
//
// El <select> nativo abre un popup que dibuja el SISTEMA OPERATIVO, no la
// página: en tema oscuro salía claro, con la barra de scroll gruesa de
// Windows, y ninguna regla de CSS lo alcanza (la app tampoco declara
// color-scheme, así que el navegador ni siquiera lo pinta oscuro). Con 24
// horas en la lista se nota mucho. Esta versión es DOM normal, así que hereda
// el tema y la barra de scroll fina.
//
// Lo que se conserva del nativo, porque es lo que la gente espera:
// clic afuera y Escape cierran, las flechas mueven, Enter elige, Home/End van
// a los extremos, y al abrir se hace scroll hasta la opción seleccionada.
// ─────────────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: number;
  label: string;
}

interface Props {
  /** Etiqueta visible. Se omite cuando el control ya está rotulado por otro de al lado (ver ariaLabel). */
  label?: string;
  /** Nombre para lectores de pantalla cuando no hay etiqueta visible. */
  ariaLabel?: string;
  value: number;
  options: SelectOption[];
  onChange: (value: number) => void;
  /** Para listas de etiquetas cortas ("8", "AM"), que no necesitan el ancho mínimo normal. */
  compact?: boolean;
}

export function Select({ label, ariaLabel, value, options, onChange, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  // Opción "marcada" con el teclado, que no es la elegida hasta que hay Enter.
  const [activo, setActivo] = useState(value);
  const raizRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);

  const seleccionada = options.find((o) => o.value === value);

  // Cerrar al hacer clic afuera. Va en 'mousedown' y no en 'click' para que
  // cerrar no dispare de paso el control que hay debajo del cursor.
  useEffect(() => {
    if (!open) return;
    const alClickear = (e: MouseEvent) => {
      if (!raizRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', alClickear);
    return () => document.removeEventListener('mousedown', alClickear);
  }, [open]);

  // Al abrir: dejar la opción actual a la vista. useLayoutEffect y no
  // useEffect para que el scroll ya esté puesto en el primer pintado — con
  // useEffect se ve un salto desde el tope de la lista.
  useLayoutEffect(() => {
    if (!open) return;
    listaRef.current?.querySelector('[data-activo="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, activo]);

  const elegir = (v: number) => {
    onChange(v);
    setActivo(v);
    setOpen(false);
    botonRef.current?.focus(); // el foco vuelve al botón, no se pierde en el body
  };

  const alTeclear = (e: React.KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === activo);

    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActivo(value);
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        elegir(activo);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActivo(options[Math.min(options.length - 1, i + 1)].value);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActivo(options[Math.max(0, i - 1)].value);
        break;
      case 'Home':
        e.preventDefault();
        setActivo(options[0].value);
        break;
      case 'End':
        e.preventDefault();
        setActivo(options[options.length - 1].value);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div className="select-field">
      {label && <span className="select-label">{label}</span>}
      <div className="select-root" ref={raizRef}>
        <button
          type="button"
          ref={botonRef}
          className={`select-trigger${compact ? ' is-compact' : ''}${open ? ' is-open' : ''}`}
          onClick={() => {
            setActivo(value);
            setOpen((v) => !v);
          }}
          onKeyDown={alTeclear}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
        >
          <span>{seleccionada?.label ?? '—'}</span>
          <svg className="select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {open && (
          <ul className="select-dropdown" role="listbox" ref={listaRef} tabIndex={-1}>
            {options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  data-activo={o.value === activo}
                  className={`select-option${o.value === value ? ' is-selected' : ''}${o.value === activo ? ' is-active' : ''}`}
                  // onMouseDown y no onClick: el mousedown de "cerrar al hacer
                  // clic afuera" corre antes que cualquier click y desmontaría
                  // la lista antes de que llegue a dispararse.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    elegir(o.value);
                  }}
                  onMouseEnter={() => setActivo(o.value)}
                >
                  {o.label}
                  {o.value === value && (
                    <svg className="select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
