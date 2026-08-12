// ─────────────────────────────────────────────────────────────────────────
// Iconos como SVG inline en vez de glifos de texto (⚙ ☀ ☾).
//
// Los glifos venían de la fuente: se renderizaban finos, con un peso y un
// tamaño que no controlábamos, y a 12.5px casi no se distinguían (a pedido del
// socio, 2026-08-11). Un SVG con stroke propio se ve igual en cualquier
// plataforma y escala sin perder nitidez.
//
// Heredan el color con `currentColor`, así que el tema claro/oscuro y el hover
// se manejan desde el CSS del botón, no acá. El tamaño lo fija .icon-button svg.
// Trazos de la familia Lucide (ISC), redibujados acá para no sumar dependencia.
// ─────────────────────────────────────────────────────────────────────────

const props = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

/** Engranaje — Configuración. */
export function GearIcon() {
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M10.3 3.2a1.5 1.5 0 0 1 3.4 0l.13.75a1.5 1.5 0 0 0 2.1 1.09l.7-.32a1.5 1.5 0 0 1 1.9 2.28l-.5.58a1.5 1.5 0 0 0 .36 2.32l.67.38a1.5 1.5 0 0 1-.6 2.8l-.76.09a1.5 1.5 0 0 0-1.24 2l.28.71a1.5 1.5 0 0 1-2.35 1.72l-.6-.48a1.5 1.5 0 0 0-2.3.6l-.32.7a1.5 1.5 0 0 1-2.82-.55l-.1-.76a1.5 1.5 0 0 0-1.97-1.22l-.72.27A1.5 1.5 0 0 1 3.6 16.2l.5-.58a1.5 1.5 0 0 0-.35-2.32l-.67-.38a1.5 1.5 0 0 1 .6-2.8l.75-.09a1.5 1.5 0 0 0 1.25-2l-.28-.71A1.5 1.5 0 0 1 7.75 3.6l.6.48a1.5 1.5 0 0 0 2.3-.6z" />
    </svg>
  );
}

/** Sol — pasar a tema claro. */
export function SunIcon() {
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

/** Luna — pasar a tema oscuro. */
export function MoonIcon() {
  return (
    <svg {...props}>
      <path d="M12 3a6.4 6.4 0 0 0 9 9 9 9 0 1 1-9-9z" />
    </svg>
  );
}
