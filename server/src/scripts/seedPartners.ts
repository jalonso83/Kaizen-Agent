import bcrypt from 'bcryptjs';
import { db } from '../db';
import { promptHidden } from './lib/prompt';
import { ROLES, ETIQUETA_ROL, esRol } from '../auth/permisos';

// ─────────────────────────────────────────────────────────────────────────
// Siembra manual de socios — DISENO_FASE1.md §11: sin registro público,
// 2-3 filas. La password se pide por stdin ENMASCARADA (no se imprime) y
// nunca se pasa como argumento de CLI ni se commitea — así no queda en el
// historial de la shell, en logs de proceso, ni en un screenshot/pantalla
// compartida.
//
// Uso: npm run seed:partner -- --email=junior@finzen.ai --name="Junior Ureña" --role=ADMIN
// (upsert por email: correr de nuevo con el mismo email actualiza esa fila)
//
// El --role es obligatorio y no tiene default a propósito: un default silencioso
// acá termina creando gente con más o con menos acceso del que se quería, y no
// hay forma de notarlo hasta que falla. Esta es además la ÚNICA vía para crear
// el primer ADMIN en una base vacía — desde la web hace falta ya ser ADMIN.
// ─────────────────────────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

async function main() {
  const email = argValue('email')?.trim().toLowerCase();
  const name = argValue('name')?.trim();

  const role = argValue('role')?.trim().toUpperCase();

  if (!email || !name || !role) {
    console.error('Uso: npm run seed:partner -- --email=alguien@finzen.ai --name="Nombre Apellido" --role=ROL');
    console.error(`Roles: ${ROLES.map((r) => `${r} (${ETIQUETA_ROL[r]})`).join(', ')}`);
    process.exit(1);
  }
  if (!esRol(role)) {
    console.error(`Rol inválido: "${role}". Roles válidos: ${ROLES.join(', ')}`);
    process.exit(1);
  }

  const password = await promptHidden('Password para el socio (no se mostrará en pantalla): ');
  if (password.length < 8) {
    console.error('La password debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const partner = await db.partner.upsert({
    where: { email },
    update: { name, role, passwordHash, disabled: false },
    create: { email, name, role, passwordHash },
  });

  console.log(`Listo: ${partner.name} <${partner.email}> — ${ETIQUETA_ROL[role]} (id ${partner.id}).`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error('Error sembrando el socio:', err instanceof Error ? err.message : err);
  process.exit(1);
});
