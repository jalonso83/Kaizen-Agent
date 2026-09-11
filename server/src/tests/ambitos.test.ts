import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AMBITOS } from '../agent/ambitos';
import { getCatalog, getSkillAmbito, getSkillBody } from '../agent/skills';
import { TOOL_LIST } from '../agent/tools';
import { buildSystemPrompt, seccionAmbitos } from '../agent/systemPrompt';

// ─────────────────────────────────────────────────────────────────────────
// Los dos ámbitos (2026-09-10): FinZen (la app) y Marketing (las redes).
//
// La separación es estructural —la carpeta del skill y el campo `ambito` de
// la tool— y el prompt se genera de ahí. Estos tests vigilan que la
// estructura no se rompa en silencio: un skill suelto o mal ubicado no da
// error de compilación, solo desaparece del catálogo con un warning.
// ─────────────────────────────────────────────────────────────────────────

const SKILLS_DIR = join(__dirname, '..', '..', 'skills');

test('no queda ningún skill suelto fuera de un ámbito', () => {
  const sueltos = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !(AMBITOS as readonly string[]).includes(d.name))
    .map((d) => d.name);
  assert.deepEqual(sueltos, [], `carpetas sin ámbito en server/skills/: ${sueltos.join(', ')}`);
});

test('todo SKILL.md del disco entra al catálogo con el ámbito de su carpeta', () => {
  for (const ambito of AMBITOS) {
    for (const dir of readdirSync(join(SKILLS_DIR, ambito), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      assert.ok(existsSync(join(SKILLS_DIR, ambito, dir.name, 'SKILL.md')), `${ambito}/${dir.name} sin SKILL.md`);
      // El slug del frontmatter coincide con la carpeta (convención SKILLS.md).
      assert.equal(getSkillAmbito(dir.name), ambito, `${dir.name} no está en el catálogo como ${ambito}`);
      assert.ok(getSkillBody(dir.name));
    }
  }
});

test('los dos ámbitos tienen skills y tools; ninguna tool queda sin ámbito', () => {
  for (const ambito of AMBITOS) {
    assert.ok(getCatalog().some((s) => s.ambito === ambito), `sin skills en ${ambito}`);
    assert.ok(TOOL_LIST.some((t) => t.ambito === ambito), `sin tools en ${ambito}`);
  }
  for (const t of TOOL_LIST) {
    assert.ok(['finzen', 'marketing', 'comun'].includes(t.ambito), `${t.name} con ámbito inválido`);
  }
});

test('las tools de escritura hacia FinZen y las de Meta están en el ámbito que corresponde', () => {
  // Si alguien reetiqueta esto, el modelo va a leer que create_campaign_draft
  // es "de marketing" y va a usarla cuando hable de Instagram.
  const ambitoDe = (n: string) => TOOL_LIST.find((t) => t.name === n)?.ambito;
  assert.equal(ambitoDe('create_campaign_draft'), 'finzen');
  assert.equal(ambitoDe('propose_campaign'), 'finzen');
  assert.equal(ambitoDe('get_kpis'), 'finzen');
  assert.equal(ambitoDe('get_meta_spend'), 'marketing');
  assert.equal(ambitoDe('save_content_draft'), 'marketing');
  assert.equal(ambitoDe('search_cerebro'), 'comun');
  assert.equal(ambitoDe('load_skill'), 'comun');
});

test('el prompt lista cada tool y cada skill dentro de su ámbito', () => {
  const texto = seccionAmbitos();
  const [finzen, marketing] = texto.split('## Marketing');
  assert.ok(finzen.includes('## FinZen'));
  for (const t of TOOL_LIST) {
    if (t.ambito === 'comun') continue;
    const lado = t.ambito === 'finzen' ? finzen : marketing;
    const otro = t.ambito === 'finzen' ? marketing : finzen;
    assert.ok(lado.includes(t.name), `${t.name} no aparece en ${t.ambito}`);
    assert.ok(!otro.includes(`, ${t.name}`) && !otro.includes(`: ${t.name}`), `${t.name} aparece en el ámbito equivocado`);
  }
  for (const s of getCatalog()) {
    const lado = s.ambito === 'finzen' ? finzen : marketing;
    assert.ok(lado.includes(`- ${s.slug} —`), `${s.slug} no aparece en ${s.ambito}`);
  }
});

test('el system prompt final trae la sección de ámbitos y las tools comunes, sin placeholders', () => {
  const base = buildSystemPrompt()[0].text;
  assert.ok(base.includes('# Tus dos ámbitos'));
  assert.ok(base.includes('## Comunes a los dos ámbitos\nTools: load_skill, search_cerebro, save_cerebro_note, list_cerebro_folders.'));
  assert.doesNotMatch(base, /\{AMBITOS\}|\{TOOLS_COMUN\}|\{CATALOG\}/);
});
