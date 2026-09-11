import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { requireAuth, requirePermission } from '../middleware/requireAuth';
import { asyncRoute } from '../middleware/asyncRoute';
import { audit } from '../services/audit';
import { perfilDeInstagram, UrlInstagramInvalida } from '../util/instagram';
import { GraphApiError } from '../clients/graphApi';
import { analizarPerfil, cuentasGuardadas, faltaConfiguracion } from '../services/instagramAnalisis';

// ─────────────────────────────────────────────────────────────────────────
// /api/marketing/accounts — los perfiles sociales que Kaizen puede leer.
//
// Lo que se GUARDA no es lo que se escribió: de la URL que pega la persona se
// deriva el usuario normalizado y una URL canónica, y eso es lo que va a la
// BD. Así el mismo perfil pegado de dos formas distintas
// (instagram.com/FinZenAI/?hl=es y instagram.com/finzenai) es una sola fila, y
// la restricción de unicidad puede hacer su trabajo.
//
// Por qué el parseo vive del lado del SERVIDOR y no del formulario: es la
// única capa que la BD no puede saltarse. Un usuario mal derivado no falla
// acá, falla mucho después al consultar la Graph API, con un mensaje que no
// menciona la URL que lo causó.
// ─────────────────────────────────────────────────────────────────────────

/** Redes soportadas. Instagram por ahora; el resto queda para después. */
const REDES = ['INSTAGRAM'] as const;
type Red = (typeof REDES)[number];

const MAX_ETIQUETA = 60;

const router = Router();
router.use(requireAuth);

/** Deriva usuario + URL canónica según la red. Hoy solo Instagram sabe hacerlo. */
function normalizar(red: Red, entrada: string): { usuario: string; url: string } {
  switch (red) {
    case 'INSTAGRAM': {
      const p = perfilDeInstagram(entrada);
      return { usuario: p.usuario, url: p.url };
    }
  }
}

// ── Leer ──────────────────────────────────────────────────────────────────

router.get(
  '/accounts',
  requirePermission('marketing:ver'),
  asyncRoute(async (_req, res) => {
    const cuentas = await db.marketingAccount.findMany({
      // La propia primero y después por fecha: es el orden en que se quiere
      // leer la lista, y evita que la interfaz tenga que reordenar.
      orderBy: [{ red: 'asc' }, { esPropia: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ cuentas });
  }),
);

// ── Crear ─────────────────────────────────────────────────────────────────

router.post(
  '/accounts',
  requirePermission('marketing:editar'),
  asyncRoute(async (req, res) => {
    const red = (req.body?.red ?? 'INSTAGRAM') as Red;
    const entrada = req.body?.url;
    const etiquetaCruda = req.body?.etiqueta;
    const esPropia = req.body?.esPropia === true;

    if (!REDES.includes(red)) {
      res.status(400).json({ message: `"red" debe ser una de: ${REDES.join(', ')}.` });
      return;
    }
    if (typeof entrada !== 'string' || entrada.trim().length === 0) {
      res.status(400).json({ message: 'Falta "url": la URL del perfil, o el usuario con arroba.' });
      return;
    }
    if (etiquetaCruda !== undefined && typeof etiquetaCruda !== 'string') {
      res.status(400).json({ message: '"etiqueta" tiene que ser texto.' });
      return;
    }
    const etiqueta = typeof etiquetaCruda === 'string' ? etiquetaCruda.trim().slice(0, MAX_ETIQUETA) : null;

    let normalizada: { usuario: string; url: string };
    try {
      normalizada = normalizar(red, entrada);
    } catch (err) {
      // El motivo del rechazo se devuelve tal cual: lo escribió util/instagram
      // pensando en quien pegó la URL ("es de una publicación, no de un
      // perfil"), y reemplazarlo por un "URL inválida" genérico perdería
      // justamente la parte útil.
      if (err instanceof UrlInstagramInvalida) {
        res.status(400).json({ message: err.message });
        return;
      }
      throw err;
    }

    try {
      // Transacción porque son dos escrituras que tienen que pasar juntas:
      // marcar esta como propia y desmarcar la anterior. Sin transacción, un
      // fallo entre las dos deja dos cuentas propias de la misma red — y esa
      // es una restricción que Postgres no puede vigilar por nosotros (haría
      // falta un índice único parcial, que Prisma no declara).
      const cuenta = await db.$transaction(async (tx) => {
        if (esPropia) {
          await tx.marketingAccount.updateMany({ where: { red, esPropia: true }, data: { esPropia: false } });
        }
        return tx.marketingAccount.create({
          data: {
            red,
            usuario: normalizada.usuario,
            url: normalizada.url,
            etiqueta: etiqueta || null,
            esPropia,
            createdBy: req.partner!.id,
          },
        });
      });

      await audit.log({
        actor: `partner:${req.partner!.id}`,
        action: 'marketing:cuenta-agregada',
        // Se registra la entrada CRUDA además de lo derivado: si algún día un
        // usuario sale mal, la única forma de entender por qué es ver qué se
        // pegó exactamente.
        input: { red, usuario: cuenta.usuario, url: cuenta.url, esPropia, entrada: entrada.trim() },
      });

      res.status(201).json(cuenta);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        res.status(409).json({
          message: `El perfil @${normalizada.usuario} ya está guardado para ${red}. Si querés cambiarle la etiqueta, editalo en vez de agregarlo de nuevo.`,
        });
        return;
      }
      throw err;
    }
  }),
);

// ── Editar ────────────────────────────────────────────────────────────────

router.patch(
  '/accounts/:id',
  requirePermission('marketing:editar'),
  asyncRoute(async (req, res) => {
    const { id } = req.params;
    const etiquetaCruda = req.body?.etiqueta;
    const esPropia = req.body?.esPropia;

    // La URL no se edita a propósito: cambiarla convierte la fila en OTRO
    // perfil, y lo que corresponde entonces es borrar y agregar — así el
    // registro de auditoría cuenta lo que de verdad pasó en vez de mostrar una
    // fila que muta de identidad.
    if (etiquetaCruda === undefined && esPropia === undefined) {
      res.status(400).json({ message: 'No hay nada que cambiar. Se puede editar "etiqueta" o "esPropia".' });
      return;
    }
    if (etiquetaCruda !== undefined && typeof etiquetaCruda !== 'string') {
      res.status(400).json({ message: '"etiqueta" tiene que ser texto.' });
      return;
    }
    if (esPropia !== undefined && typeof esPropia !== 'boolean') {
      res.status(400).json({ message: '"esPropia" tiene que ser true o false.' });
      return;
    }

    const previa = await db.marketingAccount.findUnique({ where: { id } });
    if (!previa) {
      res.status(404).json({ message: 'Esa cuenta no existe.' });
      return;
    }

    const cuenta = await db.$transaction(async (tx) => {
      if (esPropia === true) {
        await tx.marketingAccount.updateMany({
          where: { red: previa.red, esPropia: true, id: { not: id } },
          data: { esPropia: false },
        });
      }
      return tx.marketingAccount.update({
        where: { id },
        data: {
          ...(etiquetaCruda !== undefined ? { etiqueta: etiquetaCruda.trim().slice(0, MAX_ETIQUETA) || null } : {}),
          ...(esPropia !== undefined ? { esPropia } : {}),
        },
      });
    });

    await audit.log({
      actor: `partner:${req.partner!.id}`,
      action: 'marketing:cuenta-editada',
      input: {
        usuario: cuenta.usuario,
        anterior: { etiqueta: previa.etiqueta, esPropia: previa.esPropia },
        nuevo: { etiqueta: cuenta.etiqueta, esPropia: cuenta.esPropia },
      },
    });

    res.json(cuenta);
  }),
);

// ── Borrar ────────────────────────────────────────────────────────────────

router.delete(
  '/accounts/:id',
  requirePermission('marketing:editar'),
  asyncRoute(async (req, res) => {
    const { id } = req.params;

    const previa = await db.marketingAccount.findUnique({ where: { id } });
    if (!previa) {
      res.status(404).json({ message: 'Esa cuenta no existe.' });
      return;
    }

    await db.marketingAccount.delete({ where: { id } });

    // Se borra de verdad y no se deshabilita, al contrario que con los socios:
    // una cuenta de marketing no tiene conversaciones ni autorizaciones
    // colgando, así que borrarla no deja huérfano ningún registro. El evento de
    // auditoría guarda el perfil para que quede el rastro de qué se quitó.
    await audit.log({
      actor: `partner:${req.partner!.id}`,
      action: 'marketing:cuenta-borrada',
      input: { red: previa.red, usuario: previa.usuario, url: previa.url, esPropia: previa.esPropia },
    });

    res.status(204).end();
  }),
);

// ── Dashboard: la lectura de un perfil ────────────────────────────────────
//
// El MISMO análisis que devuelve la tool get_instagram_profile del agente
// (services/instagramAnalisis.ts): lo que el socio ve en el dashboard y lo que
// Kaizen le cuenta por chat salen de la misma función, con la misma caché.
//
// Los errores de Meta llegan como 502 con el texto ya traducido por el
// cliente (permiso que falta, cuenta privada, etc.): es el mismo mensaje que
// leería el agente, y sirve tal cual para mostrarlo en pantalla.

router.get(
  '/instagram/:usuario',
  requirePermission('marketing:ver'),
  asyncRoute(async (req, res) => {
    const falta = faltaConfiguracion();
    if (falta) {
      res.status(503).json({ message: 'La lectura de Instagram no está configurada: faltan META_SYSTEM_TOKEN y/o INSTAGRAM_ACCOUNT_ID en las variables del servidor.', configurado: false });
      return;
    }

    let usuario: string;
    try {
      usuario = perfilDeInstagram(String(req.params.usuario)).usuario;
    } catch (err) {
      if (err instanceof UrlInstagramInvalida) {
        res.status(400).json({ message: err.message });
        return;
      }
      throw err;
    }

    const cuenta = (await cuentasGuardadas()).find((c) => c.usuario === usuario);
    if (!cuenta) {
      res.status(404).json({ message: `@${usuario} no está entre los perfiles guardados.` });
      return;
    }

    try {
      const analisis = await analizarPerfil(cuenta, { forzar: req.query.refresh === '1' });
      res.json(analisis);
    } catch (err) {
      if (err instanceof GraphApiError) {
        await audit.log({ conversationId: null, actor: `partner:${req.partner!.id}`, action: 'marketing:instagram-error', input: { usuario }, resultSummary: err.message.slice(0, 2000), isError: true });
        res.status(502).json({ message: err.message });
        return;
      }
      throw err;
    }
  }),
);

export default router;
