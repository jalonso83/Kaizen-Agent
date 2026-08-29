import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db';
import { permisosDe, puede, type Permiso } from '../auth/permisos';

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
  role: string;
  /** Derivados del rol en CADA request, nunca guardados ni traídos del JWT. */
  permisos: readonly Permiso[];
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

/**
 * El ROL NO viaja en el JWT, a propósito. Un token dura 7 días; si el rol
 * viniera firmado ahí dentro, bajarle los permisos a alguien no tendría efecto
 * hasta que caducara su sesión — una semana de acceso que ya se le quitó. Se
 * lee de la BD en cada request, igual que `disabled`.
 */

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
    req.partner = {
      id: partner.id,
      name: partner.name,
      email: partner.email,
      role: partner.role,
      permisos: permisosDe(partner.role),
    };
    next();
  } catch (err) {
    console.error('[requireAuth] Error verificando el socio:', err instanceof Error ? err.message : err);
    res.status(500).json({ message: 'No se pudo verificar la sesión. Intenta de nuevo.' });
  }
}

/**
 * Exige un permiso concreto. Va SIEMPRE después de requireAuth.
 *
 * Esta es la garantía real: el frontend esconde las pestañas que no
 * corresponden, pero eso es cortesía visual — cualquiera puede llamar la API a
 * mano. Quitar el permiso acá es lo que de verdad cierra la puerta.
 */
export function requirePermission(permiso: Permiso) {
  return function checkPermission(req: Request, res: Response, next: NextFunction): void {
    const partner = req.partner;
    if (!partner) {
      // requireAuth no corrió antes que esto: es un error de montaje nuestro,
      // no del socio. Se niega igual, pero se deja rastro para arreglarlo.
      console.error('[requirePermission] montado sin requireAuth delante:', req.method, req.originalUrl);
      res.status(401).json({ message: 'No autenticado.' });
      return;
    }
    if (!puede(partner.role, permiso)) {
      res.status(403).json({ message: 'Tu rol no tiene acceso a esta sección.' });
      return;
    }
    next();
  };
}
