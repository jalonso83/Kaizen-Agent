import type { NextFunction, Request, RequestHandler, Response } from 'express';

// ─────────────────────────────────────────────────────────────────────────
// Express 4 no atrapa rechazos de handlers async: un error de BD sin
// try/catch deja la request colgada y, en Node reciente, un unhandled
// rejection puede tumbar el proceso entero. Este wrapper lo atrapa,
// loggea el error real, y responde 500 en español — el mismo principio que
// `withGuard` aplica a las tools, aplicado acá a las rutas HTTP.
//
// Si la respuesta ya empezó (p.ej. el SSE de /messages ya mandó headers),
// no se intenta mandar un JSON encima — solo se loggea.
// ─────────────────────────────────────────────────────────────────────────

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch((err: unknown) => {
      console.error(`[${req.method} ${req.originalUrl}]`, err instanceof Error ? err.message : err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Ocurrió un problema procesando tu solicitud. Intenta de nuevo.' });
      }
    });
  };
}
