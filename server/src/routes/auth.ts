import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { db } from '../db';
import { audit } from '../services/audit';
import { requireAuth, COOKIE_NAME } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { permisosDe } from '../auth/permisos';

// ─────────────────────────────────────────────────────────────────────────
// /api/auth — login / logout / me. DISENO_FASE1.md §11.
// Sin registro público ni recuperación de password: los socios se siembran a
// mano (npm run seed:partner). Rate limit en login; logins ok/fallidos van al
// audit log SIN passwords.
// ─────────────────────────────────────────────────────────────────────────

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días, igual al expiresIn del JWT
};

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de inicio de sesión. Espera un minuto.' },
});

router.post('/login', loginLimiter, asyncRoute(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    res.status(400).json({ message: 'Faltan email y/o password.' });
    return;
  }

  const partner = await db.partner.findUnique({ where: { email } });
  const valid = partner && !partner.disabled ? await bcrypt.compare(password, partner.passwordHash) : false;

  // Nunca se loggea la password, ni siquiera en el audit log.
  await audit.log({
    actor: partner ? `partner:${partner.id}` : `unknown:${email}`,
    action: 'login',
    isError: !valid,
    resultSummary: valid ? 'ok' : 'credenciales inválidas o cuenta deshabilitada',
  });

  if (!partner || !valid) {
    // Mensaje genérico a propósito: no revela si el email existe o si falló la password.
    res.status(401).json({ message: 'Credenciales inválidas.' });
    return;
  }

  // El rol NO se firma en el token — ver requireAuth.ts. Se manda en la
  // respuesta solo para que la UI sepa qué pintar; la autorización real la
  // hace el servidor con el rol que lee de la BD en cada request.
  const token = jwt.sign({ sub: partner.id, name: partner.name }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json({
    id: partner.id,
    name: partner.name,
    email: partner.email,
    role: partner.role,
    permisos: permisosDe(partner.role),
  });
}));

router.post('/logout', requireAuth, asyncRoute(async (req, res) => {
  res.clearCookie(COOKIE_NAME);
  await audit.log({ actor: `partner:${req.partner!.id}`, action: 'logout' });
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json(req.partner);
});

/**
 * Cambiar la propia contraseña. Existe porque las contraseñas iniciales las
 * pone un ADMIN al crear el socio (no hay envío de correos), así que sin esto
 * el ADMIN quedaría sabiendo la contraseña de todo el mundo para siempre.
 *
 * Pide la contraseña actual aunque ya haya sesión: una cookie robada o una
 * sesión abierta en una máquina prestada no debe alcanzar para quedarse con la
 * cuenta. Mismo rate limit que el login, por la misma razón.
 */
router.post('/password', loginLimiter, requireAuth, asyncRoute(async (req, res) => {
  const actual = typeof req.body?.actual === 'string' ? req.body.actual : '';
  const nueva = typeof req.body?.nueva === 'string' ? req.body.nueva : '';

  if (nueva.length < 8) {
    res.status(400).json({ message: 'La contraseña nueva debe tener al menos 8 caracteres.' });
    return;
  }
  if (nueva === actual) {
    res.status(400).json({ message: 'La contraseña nueva tiene que ser distinta de la actual.' });
    return;
  }

  const socio = await db.partner.findUnique({ where: { id: req.partner!.id } });
  const valida = socio ? await bcrypt.compare(actual, socio.passwordHash) : false;

  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'password:cambiar',
    isError: !valida,
    resultSummary: valida ? 'ok' : 'contraseña actual incorrecta',
  });

  if (!socio || !valida) {
    res.status(401).json({ message: 'La contraseña actual no es correcta.' });
    return;
  }

  await db.partner.update({
    where: { id: socio.id },
    data: { passwordHash: await bcrypt.hash(nueva, 12) },
  });

  res.json({ ok: true });
}));

export default router;
