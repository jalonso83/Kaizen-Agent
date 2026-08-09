import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { audit } from '../services/audit';
import type { SseWriter, ToolContext } from './tools/guard';
import { buildBetaTools } from './adapter';
import { buildSystemPrompt } from './systemPrompt';
import { getTonoDeMarca } from './tono';
import {
  buildHistory,
  persistUserText,
  persistAssistantMessage,
  persistToolResultMessage,
} from './history';

// ─────────────────────────────────────────────────────────────────────────
// El loop de Claude — el corazón de la Fase 1 (DISENO_FASE1.md §4).
// Usa el tool runner del SDK de Anthropic (maneja el bucle assistant↔tools).
// Cada mensaje del socio dispara una corrida con el historial de la conversación.
//
// Persistencia fiel: al terminar, `runner.params.messages` trae TODO el hilo
// (assistant + los user con tool_result que el runner generó). Guardamos los
// mensajes nuevos con sus bloques crudos → historial siempre reconstruible (§5).
//
// Este módulo y adapter.ts son los ÚNICOS que tocan el SDK beta (§14).
// ─────────────────────────────────────────────────────────────────────────

// Construcción PEREZOSA a propósito: si ANTHROPIC_API_KEY falta, el SDK tira
// al construirse (AnthropicError). Si esto fuera top-level, cualquier import
// de este módulo (o sea, arrancar el server entero) crashearía sin key —
// incluso para mostrar la web/login, que no la necesita. Se construye recién
// cuando de verdad hace falta, después de chequear que la key exista.
let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey, timeout: 120_000 });
  }
  return client;
}

export const MODEL = 'claude-opus-4-8';

function handleStopReason(message: Anthropic.Beta.BetaMessage, sse?: SseWriter): void {
  switch (message.stop_reason) {
    case 'tool_use':
      // El runner sigue solo con la siguiente iteración.
      break;
    case 'max_tokens':
      // Honesto, sin reintentar en bucle.
      sse?.send('text_delta', { text: '\n\n(Me quedé sin espacio — dime «continúa» y sigo.)' });
      sse?.send('message_done', { stopReason: 'max_tokens' });
      break;
    case 'refusal':
      sse?.send('run_error', {
        message: 'No puedo ayudarte con esa solicitud. ¿La planteamos de otra forma?',
      });
      break;
    default:
      sse?.send('message_done', { stopReason: message.stop_reason ?? 'end_turn' });
  }
}

/**
 * Corre un turno del agente para una conversación: persiste el mensaje del
 * socio, arma el historial + system + tools, corre el loop en streaming hacia
 * el SSE, y persiste los mensajes nuevos. Nunca lanza: ante error emite
 * `run_error` (en español) y audita; el mensaje del socio ya quedó guardado.
 */
export async function runAgentTurn(
  conversationId: string,
  userText: string | null,
  sse?: SseWriter,
): Promise<void> {
  // (1) commit del mensaje del socio SIEMPRE, incluso si Kaizen no puede
  // responder (kill switch / sin key) — antes esto pasaba después de los
  // guards de abajo, y el mensaje del socio se perdía sin dejar rastro
  // (bug real, encontrado 2026-07-19: "escribo algo y desaparece").
  // userText null = "reintentar respuesta" (routes/chat.ts): no hay mensaje
  // nuevo del socio, se corre sobre el historial tal cual quedó tras truncar.
  if (userText !== null) await persistUserText(conversationId, userText);

  // Kill switch propio (§3 / DISENO §0). Ni tocamos Anthropic.
  if (!config.agentEnabled) {
    sse?.send('run_error', { message: 'Kaizen está en mantenimiento. Intenta más tarde.' });
    sse?.send('done', {});
    return;
  }

  // Sin ANTHROPIC_API_KEY (modo dev sin keys — ver config.ts): no intentamos
  // construir el cliente ni conversar. El resto de la app (login,
  // conversaciones) sigue funcionando; solo esto se degrada.
  if (!config.anthropicApiKey) {
    sse?.send('run_error', {
      message: 'Kaizen todavía no tiene configurada la key de Anthropic — el resto de la app funciona, pero no puede conversar todavía.',
    });
    sse?.send('done', {});
    return;
  }

  try {
    const messages = await buildHistory(conversationId);
    const baseLen = messages.length;
    const ctx: ToolContext = { conversationId, sse };
    const tonoDeMarca = await getTonoDeMarca().catch(() => undefined); // nunca tumba el turno por esto

    const runner = getClient().beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16_000,
      thinking: { type: 'adaptive' }, // EXPLÍCITO — omitirlo = correr SIN thinking.
      // NO enviar temperature/top_p/top_k (dan 400 en Opus 4.8).
      system: buildSystemPrompt(tonoDeMarca),
      tools: buildBetaTools(ctx),
      messages,
      stream: true,
      max_iterations: 12, // tope duro contra runaway loops (un flujo típico usa 3-5).
    });

    for await (const messageStream of runner) {
      for await (const ev of messageStream) {
        if (ev.type === 'content_block_start') {
          if (ev.content_block.type === 'thinking') sse?.send('thinking', { active: true });
        } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          sse?.send('text_delta', { text: ev.delta.text });
        }
      }
      const finalMessage = await messageStream.finalMessage();
      // Persistir CADA mensaje del assistant apenas está listo, ANTES de que el
      // runner ejecute sus tool_use — no acumulado para persistir todo junto al
      // final. Antes, toda la persistencia quedaba para después del loop
      // completo, así que una tool que escribe algo con su propio timestamp
      // (p.ej. propose_campaign creando la fila Proposal) terminaba con un
      // createdAt ANTERIOR al del mensaje que la generó — la tarjeta se
      // renderizaba arriba del texto "la paso a tarjeta" en vez de abajo (bug
      // real, 2026-08-07). Persistir aquí garantiza que el createdAt del
      // mensaje quede sellado antes de que la tool corra.
      await persistAssistantMessage(conversationId, finalMessage);
      handleStopReason(finalMessage, sse);
    }

    // Los tool_result ('user') que el runner generó entre rondas — los
    // 'assistant' ya quedaron persistidos arriba, en orden correcto.
    const newMessages = runner.params.messages.slice(baseLen);
    for (const msg of newMessages) {
      if (msg.role === 'user') {
        await persistToolResultMessage(conversationId, msg.content);
      }
    }

    sse?.send('done', {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await audit.log({
      conversationId,
      actor: 'agent',
      action: 'run:error',
      resultSummary: message.slice(0, 2000),
      isError: true,
    });
    sse?.send('run_error', {
      message: 'Ocurrió un problema procesando tu mensaje. Ya quedó registrado; intenta de nuevo.',
    });
    sse?.send('done', {});
  }
}
