// ─────────────────────────────────────────────────────────────────────────
// Parseo de URLs y handles de TikTok — espejo de util/instagram.ts.
//
// Formas que pega la gente: tiktok.com/@finzenai, www.tiktok.com/@finzenai/,
// tiktok.com/@finzenai?lang=es, @finzenai, finzenai. Un enlace a un video
// (tiktok.com/@x/video/123) o a una sección (/explore, /discover) NO es un
// perfil y se rechaza con motivo.
// ─────────────────────────────────────────────────────────────────────────

const RUTAS_RESERVADAS = new Set([
  'explore', 'discover', 'foryou', 'following', 'live', 'search', 'tag', 'music',
  'upload', 'login', 'signup', 'settings', 'about', 'legal', 'privacy', 'business',
  'creators', 'embed', 'v', 't', 'i18n', 'oembed',
]);

/** Reglas de TikTok: 2 a 24 caracteres, letras, números, punto y guion bajo. */
const USUARIO_RE = /^[A-Za-z0-9._]{2,24}$/;

export interface PerfilTiktok {
  /** El usuario sin arroba y en minúsculas. */
  usuario: string;
  /** La URL canónica. */
  url: string;
}

export class UrlTiktokInvalida extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'UrlTiktokInvalida';
  }
}

export function perfilDeTiktok(entrada: string): PerfilTiktok {
  const texto = (entrada ?? '').trim();
  if (!texto) throw new UrlTiktokInvalida('Está vacío.');

  const usuario = texto.includes('/') || texto.includes('.com')
    ? usuarioDesdeUrl(texto)
    : texto.replace(/^@/, '');

  if (!USUARIO_RE.test(usuario)) {
    throw new UrlTiktokInvalida(
      `"${usuario}" no es un usuario válido de TikTok: solo letras, números, punto y guion bajo, de 2 a 24 caracteres.`,
    );
  }

  const enMinusculas = usuario.toLowerCase();
  return { usuario: enMinusculas, url: `https://www.tiktok.com/@${enMinusculas}` };
}

function usuarioDesdeUrl(texto: string): string {
  const conProtocolo = /^https?:\/\//i.test(texto) ? texto : `https://${texto}`;
  let url: URL;
  try {
    url = new URL(conProtocolo);
  } catch {
    throw new UrlTiktokInvalida(`No parece una URL: "${texto}".`);
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'tiktok.com' && !host.endsWith('.tiktok.com')) {
    throw new UrlTiktokInvalida(`El enlace es de ${host}, no de TikTok.`);
  }

  const segmentos = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  if (segmentos.length === 0) {
    throw new UrlTiktokInvalida('El enlace apunta a TikTok pero no a un perfil.');
  }

  const primero = segmentos[0];
  if (RUTAS_RESERVADAS.has(primero.toLowerCase().replace(/^@/, ''))) {
    throw new UrlTiktokInvalida(
      `El enlace es de una sección ("${primero}"), no de un perfil. Pega la URL del perfil: tiktok.com/@usuario`,
    );
  }
  if (!primero.startsWith('@')) {
    throw new UrlTiktokInvalida(`Un perfil de TikTok lleva arroba en la URL (tiktok.com/@usuario); "${primero}" no parece un perfil.`);
  }
  if (segmentos[1] === 'video' || segmentos[1] === 'photo') {
    throw new UrlTiktokInvalida('El enlace es de un video, no de un perfil. Pega la URL del perfil: tiktok.com/@usuario');
  }

  return primero.slice(1);
}
