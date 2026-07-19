import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Loader de skills — DISENO_FASE1.md §15 · SKILLS.md.
// Los skills son playbooks procedimentales de marketing que viven en el REPO
// (server/skills/<slug>/SKILL.md), NO en el Cerebro: son instrucciones, y las
// instrucciones se revisan por PR (defensa contra prompt-injection).
//
// Al boot se lee el frontmatter de cada SKILL.md y se arma el catálogo (slug +
// description). El system prompt lleva solo el catálogo; el cuerpo completo se
// carga bajo demanda con la tool load_skill. Un frontmatter inválido → warning
// y se omite ese skill, nunca crash.
// ─────────────────────────────────────────────────────────────────────────

// server/src/agent → server/skills (igual en dev con tsx y en dist tras build).
const SKILLS_DIR = resolve(__dirname, '..', '..', 'skills');

export interface SkillEntry {
  slug: string;
  description: string;
  body: string; // el SKILL.md completo (frontmatter incluido)
}

let cache: Map<string, SkillEntry> | null = null;

/** Extrae `name` y `description` del frontmatter `--- ... ---` del inicio. */
function parseFrontmatter(raw: string): { name?: string; description?: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(name|description):\s*(.+)$/);
    if (kv) out[kv[1] as 'name' | 'description'] = kv[2].trim();
  }
  return out;
}

function load(): Map<string, SkillEntry> {
  const map = new Map<string, SkillEntry>();
  let dirs: string[];
  try {
    dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err) {
    console.warn(`[skills] No se pudo leer ${SKILLS_DIR}:`, err instanceof Error ? err.message : err);
    return map;
  }

  for (const dir of dirs) {
    try {
      const body = readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8');
      const { name, description } = parseFrontmatter(body);
      if (!name || !description) {
        console.warn(`[skills] "${dir}/SKILL.md" sin name/description en el frontmatter — omitido.`);
        continue;
      }
      map.set(name, { slug: name, description, body });
    } catch (err) {
      console.warn(`[skills] No se pudo cargar "${dir}/SKILL.md" — omitido:`, err instanceof Error ? err.message : err);
    }
  }
  return map;
}

function registry(): Map<string, SkillEntry> {
  if (!cache) cache = load();
  return cache;
}

/** Catálogo (slug + description) para inyectar en el system prompt. */
export function getCatalog(): Array<{ slug: string; description: string }> {
  return [...registry().values()].map(({ slug, description }) => ({ slug, description }));
}

/** Sección "Skills disponibles" lista para pegar en el system prompt. */
export function catalogForPrompt(): string {
  const lines = getCatalog().map((s) => `- ${s.slug} — ${s.description}`);
  return lines.length ? `Skills disponibles:\n${lines.join('\n')}` : 'Skills disponibles: (ninguno cargado)';
}

/** Cuerpo completo de un skill, o null si el slug no existe. */
export function getSkillBody(slug: string): string | null {
  return registry().get(slug)?.body ?? null;
}

export function availableSlugs(): string[] {
  return [...registry().keys()];
}
