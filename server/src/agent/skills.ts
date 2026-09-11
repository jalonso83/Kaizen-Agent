import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AMBITOS, esAmbito, type Ambito } from './ambitos';

// ─────────────────────────────────────────────────────────────────────────
// Loader de skills — DISENO_FASE1.md §15 · SKILLS.md.
// Los skills son playbooks procedimentales que viven en el REPO
// (server/skills/<ambito>/<slug>/SKILL.md), NO en el Cerebro: son
// instrucciones, y las instrucciones se revisan por PR (defensa contra
// prompt-injection).
//
// Desde 2026-09-10 la carpeta intermedia es el ÁMBITO (ambitos.ts): finzen/
// para la app y su tablero, marketing/ para redes, contenido y pauta. La
// carpeta ES la clasificación — no hay un campo en el frontmatter que pueda
// decir otra cosa, y un SKILL.md suelto en server/skills/ (sin ámbito) se
// omite con warning: una skill sin ámbito no puede entrar al catálogo porque
// el prompt no sabría en qué sección ponerla.
//
// Al boot se lee el frontmatter de cada SKILL.md y se arma el catálogo (slug +
// description + ámbito). El system prompt lleva solo el catálogo; el cuerpo
// completo se carga bajo demanda con la tool load_skill. Un frontmatter
// inválido → warning y se omite ese skill, nunca crash.
// ─────────────────────────────────────────────────────────────────────────

// server/src/agent → server/skills (igual en dev con tsx y en dist tras build).
const SKILLS_DIR = resolve(__dirname, '..', '..', 'skills');

export interface SkillEntry {
  slug: string;
  description: string;
  ambito: Ambito;
  body: string; // el SKILL.md completo (frontmatter incluido)
}

let cache: Map<string, SkillEntry> | null = null;

/**
 * Extrae `name` y `description` del frontmatter `--- ... ---` del inicio.
 *
 * El \r? de la línea NO es decorativo (bug encontrado 2026-08-20): en
 * JavaScript `.` no matchea `\r`, y `$` sin flag `m` solo matchea el final del
 * string. Así que en un archivo guardado con CRLF —cosa que pasa sola editando
 * en Windows— `name: x\r` no matcheaba, el skill se omitía con un warning en
 * consola que nadie mira, y quedaba invisible para el agente. Le pasó a
 * resumen-semanal, el único de los seis con CRLF.
 */
function parseFrontmatter(raw: string): { name?: string; description?: string } {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(name|description):\s*(.+?)\r?$/);
    if (kv) out[kv[1] as 'name' | 'description'] = kv[2].trim();
  }
  return out;
}

function subdirectorios(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function load(): Map<string, SkillEntry> {
  const map = new Map<string, SkillEntry>();
  let carpetas: string[];
  try {
    carpetas = subdirectorios(SKILLS_DIR);
  } catch (err) {
    console.warn(`[skills] No se pudo leer ${SKILLS_DIR}:`, err instanceof Error ? err.message : err);
    return map;
  }

  for (const carpeta of carpetas) {
    if (!esAmbito(carpeta)) {
      // Un skill directamente bajo server/skills/ es el layout viejo (pre
      // 2026-09-10) o una carpeta con nombre equivocado. No se adivina el
      // ámbito: se avisa y se omite, que es lo que hace visible el error.
      console.warn(
        `[skills] "${carpeta}/" no es un ámbito (${AMBITOS.join(', ')}) — omitido. ` +
          `Los skills van en server/skills/<ambito>/<slug>/SKILL.md.`,
      );
      continue;
    }
    const ambito: Ambito = carpeta;
    for (const dir of subdirectorios(join(SKILLS_DIR, ambito))) {
      try {
        const body = readFileSync(join(SKILLS_DIR, ambito, dir, 'SKILL.md'), 'utf8');
        const { name, description } = parseFrontmatter(body);
        if (!name || !description) {
          console.warn(`[skills] "${ambito}/${dir}/SKILL.md" sin name/description en el frontmatter — omitido.`);
          continue;
        }
        if (map.has(name)) {
          // Dos carpetas con el mismo `name` se pisarían en silencio y el
          // modelo cargaría la que quedara última en orden de disco.
          console.warn(`[skills] "${ambito}/${dir}" repite el slug "${name}" (ya lo tiene ${map.get(name)!.ambito}) — omitido.`);
          continue;
        }
        map.set(name, { slug: name, description, ambito, body });
      } catch (err) {
        console.warn(`[skills] No se pudo cargar "${ambito}/${dir}/SKILL.md" — omitido:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return map;
}

function registry(): Map<string, SkillEntry> {
  if (!cache) cache = load();
  return cache;
}

/** Catálogo (slug + description + ámbito) para inyectar en el system prompt. */
export function getCatalog(): Array<{ slug: string; description: string; ambito: Ambito }> {
  return [...registry().values()].map(({ slug, description, ambito }) => ({ slug, description, ambito }));
}

/** Las líneas "- slug — description" de UN ámbito, para la sección de ámbitos del prompt. */
export function catalogForPrompt(ambito: Ambito): string {
  const lines = getCatalog()
    .filter((s) => s.ambito === ambito)
    .map((s) => `- ${s.slug} — ${s.description}`);
  return lines.length ? lines.join('\n') : '(ninguno cargado)';
}

/** Cuerpo completo de un skill, o null si el slug no existe. */
export function getSkillBody(slug: string): string | null {
  return registry().get(slug)?.body ?? null;
}

/** El ámbito de un skill, o null si el slug no existe. */
export function getSkillAmbito(slug: string): Ambito | null {
  return registry().get(slug)?.ambito ?? null;
}

export function availableSlugs(): string[] {
  return [...registry().keys()];
}
