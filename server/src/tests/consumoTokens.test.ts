import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { podarResultadosViejos, MIN_CHARS_PODA } from '../agent/history';
import { recortarHistorico, recortarTexto, MAX_TEXTO_PIEZA, PUNTOS_PARA_MODELO } from '../agent/tools/recorte';
import { getInstagramProfileTool } from '../agent/tools/instagram';

// ─────────────────────────────────────────────────────────────────────────
// Lo que se manda al modelo, más liviano (2026-10-10).
// ─────────────────────────────────────────────────────────────────────────

type M = Anthropic.Beta.BetaMessageParam;
const grande = 'x'.repeat(MIN_CHARS_PODA + 500);

/** Un turno: el socio pregunta, Kaizen llama una tool, la tool responde, Kaizen contesta. */
function turno(n: number, resultado: string): M[] {
  return [
    { role: 'user', content: [{ type: 'text', text: `pregunta ${n}` }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: `t${n}`, name: 'get_instagram_profile', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: resultado }] },
    { role: 'assistant', content: [{ type: 'text', text: `respuesta ${n} con las cifras` }] },
  ];
}
const resultadoDe = (msgs: M[], id: string) =>
  msgs.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => (b as { tool_use_id?: string }).tool_use_id === id) as
    | Anthropic.Beta.BetaToolResultBlockParam
    | undefined;

test('los resultados grandes de turnos viejos se recortan; los de los 2 últimos turnos no', () => {
  const msgs = [...turno(1, grande), ...turno(2, grande), ...turno(3, grande)];
  const podado = podarResultadosViejos(msgs);
  assert.equal(podado.length, msgs.length, 'no se quita ningún mensaje: los pares tool_use/tool_result siguen válidos');
  assert.match(String(resultadoDe(podado, 't1')!.content), /Resultado de get_instagram_profile de un turno anterior/);
  assert.equal(resultadoDe(podado, 't2')!.content, grande);
  assert.equal(resultadoDe(podado, 't3')!.content, grande);
  // El texto de Kaizen (donde ya citó las cifras) queda intacto.
  assert.deepEqual(podado[3], msgs[3]);
});

test('los resultados cortos viajan siempre, y con pocos turnos no se toca nada', () => {
  const msgs = [...turno(1, 'corto'), ...turno(2, grande), ...turno(3, grande)];
  assert.equal(resultadoDe(podarResultadosViejos(msgs), 't1')!.content, 'corto');
  const dos = [...turno(1, grande), ...turno(2, grande)];
  assert.strictEqual(podarResultadosViejos(dos), dos);
});

test('el recorte es determinista: el mismo historial sale igual (si no, se pierde el caché)', () => {
  const msgs = [...turno(1, grande), ...turno(2, grande), ...turno(3, grande)];
  assert.equal(JSON.stringify(podarResultadosViejos(msgs)), JSON.stringify(podarResultadosViejos(msgs)));
});

test('un error se sigue marcando como error después del recorte', () => {
  const msgs = [...turno(1, grande), ...turno(2, grande), ...turno(3, grande)];
  (msgs[2].content as Anthropic.Beta.BetaToolResultBlockParam[])[0].is_error = true;
  assert.equal(resultadoDe(podarResultadosViejos(msgs), 't1')!.is_error, true);
});

test('textos de piezas y serie histórica recortados para el modelo', () => {
  assert.equal(recortarTexto('corto'), 'corto');
  assert.equal(recortarTexto('a'.repeat(500)).length, MAX_TEXTO_PIEZA + 1);
  const h = { ventana_dias: 90, puntos: Array.from({ length: 90 }, (_, i) => ({ fecha: `d${i}` })), delta_7d: null, delta_30d: null, primera_lectura: 'd0' } as never;
  const r = recortarHistorico(h) as { puntos: Array<{ fecha: string }>; primera_lectura: string };
  assert.equal(r.puntos.length, PUNTOS_PARA_MODELO);
  assert.equal(r.puntos.at(-1)!.fecha, 'd89', 'quedan los más recientes');
  assert.equal(r.primera_lectura, 'd0', 'la primera lectura y los deltas no se tocan');
});

test('las notas de la tool de Instagram no llevan placeholders sin reemplazar', async () => {
  // Una nota armada con comillas simples y ${...} adentro llega literal al modelo.
  const desc = getInstagramProfileTool.description;
  assert.ok(!desc.includes('${'));
});
