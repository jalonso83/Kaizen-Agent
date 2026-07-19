import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db';

// ─────────────────────────────────────────────────────────────────────────
// Auth de socios — DISENO_FASE1.md §11. JWT { sub: partnerId, name } en
// cookie httpOnly, 7 días. `requireAuth` protege todo /api/* salvo login.
//
// Ownership: NO alcanza con validar el JWT — en cada request se busca el
// Partner en BD para chequear `disabled`, así "Partner.disabled=true revoca
// al siguiente request" (no hay que esperar a que expire el token de 7 días).
// ─────────────────────────────────────────────────────────────────────────

export const COOKIE_NAME = 'kaizen_token';

export interface AuthedPartner {
  id: string;
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partner?: AuthedPartner;
    }
  }
}

interface KaizenJwtPayload {
  sub: string;
  name: string;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  let payload: KaizenJwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as KaizenJwtPayload;
  } catch {
    res.status(401).json({ message: 'Sesión inválida o expirada. Inicia sesión de nuevo.' });
    return;
  }

  try {
    const partner = await db.partner.findUnique({ where: { id: payload.sub } });
    if (!partner || partner.disabled) {
      res.status(401).json({ message: 'Cuenta deshabilitada o inexistente.' });
      return;
    }
    req.partner = { id: partner.id, name: partner.name, email: partner.email };
    next();
  } catch (err) {
    console.error('[requireAuth] Error verificando el socio:', err instanceof Error ? err.message : err);
    res.status(500).json({ message: 'No se pudo verificar la sesión. Intenta de nuevo.' });
  }
}
