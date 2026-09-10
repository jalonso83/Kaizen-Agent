import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISOS, ROLES, permisosDe, puede, esRol } from '../auth/permisos';

// ─────────────────────────────────────────────────────────────────────────
// La tabla de permisos es la única fuente de verdad de quién puede qué, así
// que un cambio accidental acá es un agujero de autorización que no se nota
// hasta que alguien entra donde no debía.
//
// Estas pruebas fijan lo que NO debe cambiar sin querer: que los permisos
// sensibles sean exclusivos de ADMIN, y que un rol desconocido no obtenga
// nada.
// ─────────────────────────────────────────────────────────────────────────

/** Lo que solo puede hacer un CEO / CTO. */
const SOLO_ADMIN = [
  'campanas:confirmar',
  'metas:confirmar',
  'auditoria:ver',
  'config:editar',
  'marketing:ver',
  'marketing:editar',
  'usuarios:gestionar',
] as const;

test('los permisos sensibles son exclusivos de ADMIN', () => {
  for (const permiso of SOLO_ADMIN) {
    assert.equal(puede('ADMIN', permiso), true, `ADMIN debería tener ${permiso}`);
    assert.equal(puede('ASSISTANT', permiso), false, `ASSISTANT NO debería tener ${permiso}`);
    assert.equal(puede('USER', permiso), false, `USER NO debería tener ${permiso}`);
  }
});

test('marketing:ver existe y es solo de ADMIN', () => {
  // El apartado de Marketing guarda las cuentas del negocio hacia afuera.
  assert.ok((PERMISOS as readonly string[]).includes('marketing:ver'));
  assert.deepEqual(
    ROLES.filter((r) => puede(r, 'marketing:ver')),
    ['ADMIN'],
  );
});

test('los tres roles pueden usar el chat', () => {
  for (const rol of ROLES) assert.equal(puede(rol, 'chat'), true, rol);
});

test('ASSISTANT ve las metas pero no las confirma', () => {
  assert.equal(puede('ASSISTANT', 'metas:ver'), true);
  assert.equal(puede('ASSISTANT', 'metas:confirmar'), false);
});

test('ADMIN tiene todos los permisos declarados', () => {
  assert.deepEqual([...permisosDe('ADMIN')].sort(), [...PERMISOS].sort());
});

test('un rol desconocido no obtiene NINGÚN permiso', () => {
  // Ante la duda se niega: es el único de los dos errores que no publica nada.
  for (const basura of ['BASURA', '', 'admin', 'ADMIN ', 'Marketing']) {
    assert.deepEqual(permisosDe(basura), [], JSON.stringify(basura));
    assert.equal(esRol(basura), false, JSON.stringify(basura));
  }
});

test('la lista de permisos no tiene duplicados', () => {
  assert.equal(new Set(PERMISOS).size, PERMISOS.length);
});
