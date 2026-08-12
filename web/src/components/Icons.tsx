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
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1.1 1.79l-.78.39a2 2 0 0 1-2.56-.9l-.2-.31a2 2 0 0 0-2.81-.55l-.31.2a2 2 0 0 0-.55 2.81l.2.31a2 2 0 0 1-.9 2.56l-.39.78a2 2 0 0 1-1.79 1.1H2a2 2 0 0 0-2 2v.44a2 2 0 0 0 2 2h.18a2 2 0 0 1 1.1 1.79l.39.78a2 2 0 0 1-.9 2.56l-.2.31a2 2 0 0 0 .55 2.81l.31.2a2 2 0 0 0 2.81-.55l.2-.31a2 2 0 0 1 2.56-.9l.78.39a2 2 0 0 1 1.1 1.79V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1.1-1.79l.78-.39a2 2 0 0 1 2.56.9l.2.31a2 2 0 0 0 2.81.55l.31-.2a2 2 0 0 0 .55-2.81l-.2-.31a2 2 0 0 1 .9-2.56l.39-.78a2 2 0 0 1 1.79-1.1H22a2 2 0 0 0 2-2v-.44a2 2 0 0 0-2-2h-.18a2 2 0 0 1-1.1-1.79l-.39-.78a2 2 0 0 1 .9-2.56l.2-.31a2 2 0 0 0-.55-2.81l-.31-.2a2 2 0 0 0-2.81.55l-.2.31a2 2 0 0 1-2.56.9l-.78-.39A2 2 0 0 1 12.4 4.18V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
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
