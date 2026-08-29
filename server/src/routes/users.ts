import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { audit } from '../services/audit';
import { requireAuth, requirePermission } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { ROLES, ETIQUETA_ROL, DESCRIPCION_ROL, esRol, permisosDe } from '../auth/permisos';

// ─────────────────────────────────────────────────────────────────────────
// /api/users — gestión de socios. Solo el rol ADMIN (CEO/CTO).
//
// Tres reglas que no son configurables, porque son las que evitan quedarse
// afuera del propio sistema:
//
//   1. Nadie cambia su propio rol. Si pudieras, el permiso `usuarios:gestionar`
//      sería un botón de "hazme lo que quiera ser" y el resto de los permisos
//      dejaría de significar nada.
//   2. Nadie se deshabilita a sí mismo. Es un pie en la puerta, no una defensa
//      seria, pero evita el accidente más tonto posible.
//   3. Nunca queda el sistema sin un ADMIN habilitado. Sin eso, un solo click
//      deja a TODOS sin poder repartir roles, y la única salida es entrar a la
//      base de datos de producción a mano.
//
// Sobre la 3: hoy NO se puede llegar a ella por HTTP, y eso está bien. Para
// dejar cero admins habría que degradar o apagar al último, y el único que
// puede hacerlo es un ADMIN — que al ser también admin ya garantiza que quede
// uno. Se deja igual porque es la red que atrapa el día que alguien relaje las
// reglas 1 o 2 ("dejemos que uno pueda renunciar a su rol"): sin ella, ese
// cambio de una línea abre el lockout sin que nadie lo note. Está sin cubrir
// por la prueba end-to-end justamente porque no hay forma de provocarla.
//
// No se BORRAN socios, se deshabilitan. Un socio borrado se lleva por delante
// sus conversaciones (FK) y deja el audit log lleno de `partner:<id>` que ya no
// resuelven a ningún nombre — o sea, destruye justo el registro que existe para
// poder reconstruir quién autorizó qué. Deshabilitar corta el acceso al
// siguiente request y conserva la historia.
// ─────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);
router.use(requirePermission('usuarios:gestionar'));

const PASSWORD_MIN = 8;

/** Lo que se expone de un socio. NUNCA incluye passwordHash. */
const CAMPOS_PUBLICOS = {
  id: true,
  email: true,
  name: true,
  role: true,
  disabled: true,
  createdAt: true,
  createdBy: true,
} as const;

type SocioFila = {
  id: string;
  email: string;
  name: string;
  role: string;
  disabled: boolean;
  createdAt: Date;
  createdBy: string | null;
};

function serializar(p: SocioFila) {
  return { ...p, permisos: permisosDe(p.role), rolLabel: ETIQUETA_ROL[p.role as never] ?? p.role };
}

/**
 * ¿Este cambio deja el sistema sin ningún ADMIN habilitado? Corre DENTRO de la
 * transacción que hace el cambio: contar antes y escribir después deja una
 * ventana en la que dos admins pueden degradarse a la vez y ambos pasar el
 * chequeo, quedando cero.
 */
async function quedaAlgunAdmin(
  tx: { partner: { count: (a: unknown) => Promise<number> } },
  idQueCambia: string,
  seguiraSiendoAdminHabilitado: boolean,
): Promise<boolean> {
  if (seguiraSiendoAdminHabilitado) return true;
  const otros = await tx.partner.count({
    where: { role: 'ADMIN', disabled: false, id: { not: idQueCambia } },
  });
  return otros > 0;
}

/** Catálogo de roles, para que el frontend no tenga que duplicar la tabla. */
router.get('/roles', (_req, res) => {
  res.json({
    roles: ROLES.map((r) => ({
      value: r,
      label: ETIQUETA_ROL[r],
      descripcion: DESCRIPCION_ROL[r],
      permisos: permisosDe(r),
    })),
  });
});

router.get('/', asyncRoute(async (_req, res) => {
  const socios = await db.partner.findMany({
    orderBy: [{ disabled: 'asc' }, { createdAt: 'asc' }],
    select: CAMPOS_PUBLICOS,
  });
  res.json({ usuarios: socios.map(serializar) });
}));

router.post('/', asyncRoute(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const role = typeof req.body?.role === 'string' ? req.body.role : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !name) {
    res.status(400).json({ message: 'Faltan el nombre y/o el correo.' });
    return;
  }
  if (!email.includes('@')) {
    res.status(400).json({ message: 'El correo no parece válido.' });
    return;
  }
  if (!esRol(role)) {
    res.status(400).json({ message: 'Rol inválido.' });
    return;
  }
  if (password.length < PASSWORD_MIN) {
    res.status(400).json({ message: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.` });
    return;
  }

  const yaExiste = await db.partner.findUnique({ where: { email } });
  if (yaExiste) {
    res.status(409).json({ message: 'Ya hay un socio con ese correo.' });
    return;
  }

  const creado = await db.partner.create({
    data: { email, name, role, passwordHash: await bcrypt.hash(password, 12), createdBy: req.partner!.id },
    select: CAMPOS_PUBLICOS,
  });

  // La password JAMÁS entra al audit log, ni su largo.
  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'usuario:crear',
    input: { email, name, role },
    resultSummary: `creó a ${name} <${email}> como ${ETIQUETA_ROL[role]}`,
  });

  res.status(201).json(serializar(creado));
}));

/** Cambia nombre y/o rol. El rol es lo delicado: es escalar privilegios. */
router.patch('/:id', asyncRoute(async (req, res) => {
  const objetivoId = req.params.id;
  const actorId = req.partner!.id;

  const nombreNuevo = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
  const rolNuevo = req.body?.role;

  if (rolNuevo !== undefined && !esRol(rolNuevo)) {
    res.status(400).json({ message: 'Rol inválido.' });
    return;
  }
  if (nombreNuevo !== undefined && !nombreNuevo) {
    res.status(400).json({ message: 'El nombre no puede quedar vacío.' });
    return;
  }

  if (rolNuevo !== undefined && objetivoId === actorId) {
    res.status(400).json({
      message: 'No puedes cambiar tu propio rol. Pídeselo a otra persona con rol CEO / CTO.',
    });
    return;
  }

  try {
    const actualizado = await db.$transaction(async (tx) => {
      const objetivo = await tx.partner.findUnique({ where: { id: objetivoId } });
      if (!objetivo) throw new Error('NO_EXISTE');

      const rolFinal = rolNuevo ?? objetivo.role;
      const seguiraSiendoAdmin = rolFinal === 'ADMIN' && !objetivo.disabled;
      if (!(await quedaAlgunAdmin(tx as never, objetivoId, seguiraSiendoAdmin))) {
        throw new Error('ULTIMO_ADMIN');
      }

      return tx.partner.update({
        where: { id: objetivoId },
        data: {
          ...(nombreNuevo !== undefined ? { name: nombreNuevo } : {}),
          ...(rolNuevo !== undefined ? { role: rolNuevo } : {}),
        },
        select: CAMPOS_PUBLICOS,
      });
    });

    await audit.log({
      actor: `partner:${actorId}`,
      action: 'usuario:actualizar',
      input: { id: objetivoId, name: nombreNuevo, role: rolNuevo },
      resultSummary: `actualizó a ${actualizado.name}${rolNuevo ? ` → ${ETIQUETA_ROL[rolNuevo as never]}` : ''}`,
    });

    res.json(serializar(actualizado));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : '';
    if (motivo === 'NO_EXISTE') {
      res.status(404).json({ message: 'Ese socio no existe.' });
      return;
    }
    if (motivo === 'ULTIMO_ADMIN') {
      res.status(409).json({
        message: 'Es el único CEO / CTO habilitado. Nombra a otro antes de cambiarle el rol, o nadie podrá repartir permisos.',
      });
      return;
    }
    throw err;
  }
}));

/** Habilita o deshabilita. Deshabilitar corta el acceso en el request siguiente. */
router.post('/:id/disabled', asyncRoute(async (req, res) => {
  const objetivoId = req.params.id;
  const actorId = req.partner!.id;
  const disabled = req.body?.disabled;

  if (typeof disabled !== 'boolean') {
    res.status(400).json({ message: 'Falta "disabled" (true o false).' });
    return;
  }
  if (disabled && objetivoId === actorId) {
    res.status(400).json({ message: 'No puedes deshabilitarte a ti mismo.' });
    return;
  }

  try {
    const actualizado = await db.$transaction(async (tx) => {
      const objetivo = await tx.partner.findUnique({ where: { id: objetivoId } });
      if (!objetivo) throw new Error('NO_EXISTE');

      const seguiraSiendoAdmin = objetivo.role === 'ADMIN' && !disabled;
      if (!(await quedaAlgunAdmin(tx as never, objetivoId, seguiraSiendoAdmin))) {
        throw new Error('ULTIMO_ADMIN');
      }

      return tx.partner.update({ where: { id: objetivoId }, data: { disabled }, select: CAMPOS_PUBLICOS });
    });

    await audit.log({
      actor: `partner:${actorId}`,
      action: disabled ? 'usuario:deshabilitar' : 'usuario:habilitar',
      input: { id: objetivoId },
      resultSummary: `${disabled ? 'deshabilitó' : 'habilitó'} a ${actualizado.name}`,
    });

    res.json(serializar(actualizado));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : '';
    if (motivo === 'NO_EXISTE') {
      res.status(404).json({ message: 'Ese socio no existe.' });
      return;
    }
    if (motivo === 'ULTIMO_ADMIN') {
      res.status(409).json({
        message: 'Es el único CEO / CTO habilitado. Si lo deshabilitas nadie podrá volver a repartir permisos.',
      });
      return;
    }
    throw err;
  }
}));

/** Restablece la contraseña de otro socio. */
router.post('/:id/password', asyncRoute(async (req, res) => {
  const objetivoId = req.params.id;
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (password.length < PASSWORD_MIN) {
    res.status(400).json({ message: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.` });
    return;
  }

  const objetivo = await db.partner.findUnique({ where: { id: objetivoId } });
  if (!objetivo) {
    res.status(404).json({ message: 'Ese socio no existe.' });
    return;
  }

  await db.partner.update({
    where: { id: objetivoId },
    data: { passwordHash: await bcrypt.hash(password, 12) },
  });

  // Se registra QUE pasó y a quién, nunca el valor.
  await audit.log({
    actor: `partner:${req.partner!.id}`,
    action: 'usuario:password-restablecida',
    input: { id: objetivoId },
    resultSummary: `restableció la contraseña de ${objetivo.name}`,
  });

  res.json({ ok: true });
}));

export default router;
