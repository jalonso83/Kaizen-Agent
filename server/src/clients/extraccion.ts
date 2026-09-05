// ─────────────────────────────────────────────────────────────────────────
// El contrato de la extracción de texto, en su propio módulo.
//
// Vive separado de `documentos.ts` por una razón concreta: `vision.ts` (la
// lectura de imágenes) necesita este tipo y este error, y `documentos.ts`
// necesita llamar a `vision.ts` para despachar las imágenes. Si el contrato
// viviera en `documentos.ts`, los dos se importarían mutuamente.
//
// `documentos.ts` lo re-exporta, así que quien ya importaba desde ahí
// (drive.ts, jobs/cerebroIndex.ts) sigue igual.
// ─────────────────────────────────────────────────────────────────────────

export interface Extraccion {
  texto: string;
  /** Con qué se extrajo — viaja al audit log para poder diagnosticar. */
  via: string;
  /** Aviso que debe llegar al lector (truncado, hojas omitidas, etc.). */
  aviso?: string;
}

/**
 * Un archivo soportado del que NO se pudo sacar texto. No es lo mismo que
 * "tipo no soportado" (eso es un `null`): esta distinción es la que permite que
 * un `.png` omitido se vea distinto de un PDF que se quiso leer y no dio texto.
 */
export class SinTextoError extends Error {
  constructor(
    public readonly via: string,
    motivo: string,
  ) {
    super(motivo);
    this.name = 'SinTextoError';
  }
}
