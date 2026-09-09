// ─────────────────────────────────────────────────────────────────────────
// De una URL de Instagram al nombre de usuario.
//
// Sirve para cualquiera de los dos caminos posibles de lectura de perfiles
// (Graph API o scraping): los dos necesitan el usuario, no la URL. Lo que se
// guarda en la configuración de Marketing es una URL porque es lo que una
// persona tiene a mano — copiada de la barra del navegador, con su `?hl=es` y
// su barra final.
//
// Se acepta también el handle pelado (`@finzenai`) porque es lo que la gente
// escribe cuando no tiene la URL abierta.
//
// Lo que NO se acepta, a propósito: enlaces a una publicación, un reel o una
// historia. Se parecen a un perfil —el dominio es el mismo— pero el primer
// segmento es una ruta reservada, no un usuario. Aceptarlos daría un "usuario"
// llamado `p` o `reel` y el error aparecería recién al consultar la API.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Rutas de instagram.com que NO son perfiles. La lista es la de las secciones
 * públicas que alguien podría llegar a pegar por error.
 */
const RUTAS_RESERVADAS = new Set([
  'p',
  'reel',
  'reels',
  'stories',
  'stories_archive',
  'tv',
  'explore',
  'accounts',
  'direct',
  'about',
  'developer',
  'legal',
  'privacy',
  'terms',
  'emails',
  'challenge',
  'oauth',
  'web',
  'graphql',
  'api',
]);

/**
 * Reglas de Instagram para un nombre de usuario: 1 a 30 caracteres, letras,
 * números, punto y guion bajo. Sin acentos ni espacios.
 */
const USUARIO_RE = /^[A-Za-z0-9._]{1,30}$/;

export interface PerfilInstagram {
  /** El usuario, sin arroba y en minúsculas — así lo espera la Graph API. */
  usuario: string;
  /** La URL canónica, para mostrar y para abrir desde la interfaz. */
  url: string;
}

export class UrlInstagramInvalida extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'UrlInstagramInvalida';
  }
}

/**
 * Extrae el usuario de una URL de perfil de Instagram (o de un handle pelado).
 *
 * Lanza `UrlInstagramInvalida` con un motivo legible en vez de devolver null:
 * esto se llama al guardar la configuración, y quien la guarda tiene que saber
 * POR QUÉ no se aceptó lo que pegó.
 */
export function perfilDeInstagram(entrada: string): PerfilInstagram {
  const texto = (entrada ?? '').trim();
  if (!texto) throw new UrlInstagramInvalida('Está vacío.');

  const usuario = texto.includes('/') || texto.includes('.com')
    ? usuarioDesdeUrl(texto)
    : texto.replace(/^@/, '');

  if (!USUARIO_RE.test(usuario)) {
    throw new UrlInstagramInvalida(
      `"${usuario}" no es un usuario válido de Instagram: solo letras, números, punto y guion bajo, hasta 30 caracteres.`,
    );
  }

  const enMinusculas = usuario.toLowerCase();
  return { usuario: enMinusculas, url: `https://www.instagram.com/${enMinusculas}` };
}

function usuarioDesdeUrl(texto: string): string {
  // Sin protocolo (`instagram.com/finzenai`) el constructor de URL lo toma como
  // ruta relativa y se pierde el dominio. Se le antepone uno.
  const conProtocolo = /^https?:\/\//i.test(texto) ? texto : `https://${texto}`;

  let url: URL;
  try {
    url = new URL(conProtocolo);
  } catch {
    throw new UrlInstagramInvalida(`No parece una URL: "${texto}".`);
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) {
    throw new UrlInstagramInvalida(`El enlace es de ${host}, no de Instagram.`);
  }

  const segmentos = url.pathname.split('/').filter(Boolean);
  if (segmentos.length === 0) {
    throw new UrlInstagramInvalida('El enlace apunta a Instagram pero no a un perfil.');
  }

  const primero = decodeURIComponent(segmentos[0]);
  if (RUTAS_RESERVADAS.has(primero.toLowerCase())) {
    throw new UrlInstagramInvalida(
      `El enlace es de una publicación o sección ("${primero}"), no de un perfil. Pega la URL del perfil: instagram.com/usuario`,
    );
  }

  return primero.replace(/^@/, '');
}
