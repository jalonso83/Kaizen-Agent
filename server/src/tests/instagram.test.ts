import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perfilDeInstagram, UrlInstagramInvalida } from '../util/instagram';

// ─────────────────────────────────────────────────────────────────────────
// URL de Instagram → usuario. Lo que se guarda en Marketing es una URL porque
// es lo que una persona tiene a mano; lo que necesita cualquier lectura de
// perfil es el usuario.
//
// El caso que más importa es el de las rutas reservadas: un enlace a una
// publicación se parece muchísimo a uno de perfil, y aceptarlo daría un
// "usuario" llamado `p` que recién falla al consultar la API.
// ─────────────────────────────────────────────────────────────────────────

const usuarioDe = (entrada: string) => perfilDeInstagram(entrada).usuario;

test('acepta las formas en que la gente pega una URL de perfil', () => {
  const equivalentes = [
    'https://www.instagram.com/finzenai',
    'https://www.instagram.com/finzenai/',
    'https://instagram.com/finzenai',
    'http://instagram.com/finzenai',
    'instagram.com/finzenai',
    'www.instagram.com/finzenai/',
    'https://www.instagram.com/finzenai?hl=es',
    'https://www.instagram.com/finzenai/?igsh=abc123',
    'https://www.instagram.com/finzenai#algo',
  ];
  for (const entrada of equivalentes) {
    assert.equal(usuarioDe(entrada), 'finzenai', entrada);
  }
});

test('acepta el handle pelado, con y sin arroba', () => {
  assert.equal(usuarioDe('@finzenai'), 'finzenai');
  assert.equal(usuarioDe('finzenai'), 'finzenai');
  assert.equal(usuarioDe('  @finzenai  '), 'finzenai');
});

test('normaliza a minúsculas: la Graph API espera el usuario así', () => {
  assert.equal(usuarioDe('https://www.instagram.com/FinZenAI'), 'finzenai');
  assert.equal(usuarioDe('@FinZenAI'), 'finzenai');
});

test('devuelve también la URL canónica, sin parámetros ni barra final', () => {
  const p = perfilDeInstagram('https://www.instagram.com/finzenai/?hl=es');
  assert.equal(p.url, 'https://www.instagram.com/finzenai');
});

test('acepta los caracteres que Instagram permite en un usuario', () => {
  assert.equal(usuarioDe('instagram.com/fin_zen.ai'), 'fin_zen.ai');
  assert.equal(usuarioDe('instagram.com/finzen2026'), 'finzen2026');
});

test('RECHAZA enlaces a publicaciones, reels e historias', () => {
  const noSonPerfiles = [
    'https://www.instagram.com/p/C1a2b3c4/',
    'https://www.instagram.com/reel/C1a2b3c4/',
    'https://www.instagram.com/reels/C1a2b3c4/',
    'https://www.instagram.com/stories/finzenai/123456/',
    'https://www.instagram.com/explore/tags/finanzas/',
    'https://www.instagram.com/accounts/login/',
  ];
  for (const entrada of noSonPerfiles) {
    assert.throws(
      () => perfilDeInstagram(entrada),
      (err: unknown) => {
        assert.ok(err instanceof UrlInstagramInvalida, entrada);
        // El mensaje tiene que decir qué hacer, no solo que está mal.
        assert.match(err.message, /perfil/i, entrada);
        return true;
      },
      entrada,
    );
  }
});

test('RECHAZA enlaces de otros dominios, incluso si parecen de Instagram', () => {
  for (const entrada of [
    'https://facebook.com/finzenai',
    'https://tiktok.com/@finzenai',
    'https://instagram.com.attacker.net/finzenai',
    'https://notinstagram.com/finzenai',
  ]) {
    assert.throws(() => perfilDeInstagram(entrada), UrlInstagramInvalida, entrada);
  }
});

test('acepta subdominios reales de instagram.com', () => {
  assert.equal(usuarioDe('https://es.instagram.com/finzenai'), 'finzenai');
});

test('RECHAZA lo vacío y lo que no es una URL', () => {
  for (const entrada of ['', '   ', 'https://instagram.com', 'https://instagram.com/']) {
    assert.throws(() => perfilDeInstagram(entrada), UrlInstagramInvalida, JSON.stringify(entrada));
  }
});

test('RECHAZA usuarios imposibles', () => {
  for (const entrada of [
    'instagram.com/' + 'a'.repeat(31), // el tope son 30
    'instagram.com/con espacio',
    'instagram.com/acentué',
    '@con-guion-medio',
  ]) {
    assert.throws(() => perfilDeInstagram(entrada), UrlInstagramInvalida, entrada);
  }
});

test('el motivo del rechazo es legible para quien pegó la URL', () => {
  try {
    perfilDeInstagram('https://tiktok.com/@finzenai');
    assert.fail('debería haber lanzado');
  } catch (err) {
    assert.ok(err instanceof UrlInstagramInvalida);
    assert.match(err.message, /tiktok\.com/);
  }
});
