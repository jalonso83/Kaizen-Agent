import bcrypt from 'bcryptjs';
import { db } from '../db';
import { promptHidden } from './lib/prompt';

// ─────────────────────────────────────────────────────────────────────────
// Siembra manual de socios — DISENO_FASE1.md §11: sin registro público,
// 2-3 filas. La password se pide por stdin ENMASCARADA (no se imprime) y
// nunca se pasa como argumento de CLI ni se commitea — así no queda en el
// historial de la shell, en logs de proceso, ni en un screenshot/pantalla
// compartida.
//
// Uso: npm run seed:partner -- --email=junior@finzen.ai --name="Junior Ureña"
// (upsert por email: correr de nuevo con el mismo email actualiza esa fila)
// ─────────────────────────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

async function main() {
  const email = argValue('email')?.trim().toLowerCase();
  const name = argValue('name')?.trim();

  if (!email || !name) {
    console.error('Uso: npm run seed:partner -- --email=alguien@finzen.ai --name="Nombre Apellido"');
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
    update: { name, passwordHash, disabled: false },
    create: { email, name, passwordHash },
  });

  console.log(`Listo: ${partner.name} <${partner.email}> (id ${partner.id}).`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error('Error sembrando el socio:', err instanceof Error ? err.message : err);
  process.exit(1);
});
