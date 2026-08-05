import { getClient } from './runner';

// ─────────────────────────────────────────────────────────────────────────
// Título automático de conversación, generado tras el primer intercambio —
// mismo patrón que Claude.ai/Claude Code. Llamada aparte, chica y barata
// (Haiku, sin tools, sin thinking): no reusa el MODEL de runner.ts porque no
// necesita la inteligencia de Opus para resumir una oración en 3-6 palabras.
// ─────────────────────────────────────────────────────────────────────────

const TITLE_MODEL = 'claude-haiku-4-5';

/**
 * Genera un título corto (3-6 palabras, sin comillas ni punto final) a partir
 * del primer mensaje del socio y, si ya existe, la primera respuesta de
 * Kaizen. Nunca lanza: ante cualquier error del modelo, devuelve `null` para
 * que el llamador simplemente deje el título por defecto ("Nueva conversación").
 */
export async function generateConversationTitle(
  firstUserText: string,
  firstAssistantText?: string,
): Promise<string | null> {
  try {
    const context = firstAssistantText
      ? `Socio: ${firstUserText}\n\nKaizen: ${firstAssistantText}`
      : `Socio: ${firstUserText}`;

    const response = await getClient().messages.create({
      model: TITLE_MODEL,
      max_tokens: 30,
      system:
        'Generas títulos cortos de conversación en español, estilo Claude.ai: 3 a 6 palabras, sin comillas, sin punto final, sin emojis. ' +
        'Responde ÚNICAMENTE con el título — nada de preámbulo ni explicación.',
      messages: [{ role: 'user', content: `Generá el título para esta conversación:\n\n${context}` }],
    });

    const block = response.content.find((b) => b.type === 'text');
    const title = block && block.type === 'text' ? block.text.trim().replace(/^["']|["']$/g, '') : '';
    if (!title || title.length > 200) return null;
    return title;
  } catch {
    return null; // degradación silenciosa — el título por defecto queda tal cual
  }
}
