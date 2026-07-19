import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────
// PrismaClient singleton. En dev con `tsx watch` el módulo se recarga; el
// guard en globalThis evita abrir una conexión nueva en cada recarga.
// Requiere DATABASE_URL (Postgres). Ver DISENO_FASE1.md §1.
//
// El `dotenv/config` de acá es a propósito, no redundante con config.ts: los
// scripts standalone (seedPartners.ts, etc.) importan `db` sin pasar por
// `config.ts`, así que sin esto Prisma nunca ve el .env fuera del server
// principal (bug real, encontrado 2026-07-19). dotenv.config() es idempotente
// — llamarlo de nuevo desde config.ts no pisa nada.
// ─────────────────────────────────────────────────────────────────────────

const globalForPrisma = globalThis as unknown as { __kaizenPrisma?: PrismaClient };

export const db = globalForPrisma.__kaizenPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__kaizenPrisma = db;
}
