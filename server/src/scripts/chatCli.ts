import 'dotenv/config';
import { promptHidden, promptVisible } from './lib/prompt';

// ─────────────────────────────────────────────────────────────────────────
// Cliente de consola para hablar con Kaizen — corre desde cualquier terminal
// (PowerShell, cmd, bash). Es también la primera implementación real del
// parser de SSE que describe DISENO_FASE1.md §10 para useAgentStream: mismo
// patrón (fetch + reader.getReader() + split en "\n\n"), así que además sirve
// de referencia ya probada para cuando se construya el hook de React.
//
// KAIZEN_BASE_URL se puede poner en .env (se carga acá con dotenv) o pasar
// como variable de shell real — no es una config del server, es solo para
// este script; no vive en config.ts.
//
// Uso:
//   npm run chat
//   npm run chat -- --url=https://kaizen-agent-production.up.railway.app
//   npm run chat -- --resume=<conversationId>
// ─────────────────────────────────────────────────────────────────────────

const ansi = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

// Kaizen responde en Markdown (systemPrompt.ts §Estilo) — la terminal no lo
// interpreta sola, así que sin esto se ven los "##"/"**" literales (mismo
// problema que tenía el chat web antes de sumar ReactMarkdown). Reglas
// mínimas por línea, a propósito nada más: encabezados en negrita, **negrita**
// inline, `code` atenuado, "- item" con viñeta — cubre lo que el system
// prompt realmente pide usar.
function renderMarkdownLine(line: string): string {
  const headerMatch = line.match(/^#{1,4}\s+(.*)$/);
  if (headerMatch) return ansi.bold(headerMatch[1]);

  let out = line.replace(/^(\s*)[-*]\s+/, '$1  • ');
  out = out.replace(/\*\*(.+?)\*\*/g, (_m, inner: string) => ansi.bold(inner));
  out = out.replace(/`([^`]+)`/g, (_m, inner: string) => ansi.dim(inner));
  return out;
}

function renderMarkdownBlock(text: string): string {
  return text.split('\n').map(renderMarkdownLine).join('\n');
}

function argValue(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

const baseUrl = (argValue('url') ?? process.env.KAIZEN_BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/** Cookie jar mínimo: un solo valor, la sesión de este proceso. */
let sessionCookie = '';

function extractCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/^([^=]+=[^;]+)/);
  return match ? match[1] : null;
}

async function readJson<T>(res: Response, fallback: T): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (sessionCookie) headers.set('Cookie', sessionCookie);

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });

  const setCookie = res.headers.get('set-cookie');
  const cookie = extractCookie(setCookie);
  if (cookie) sessionCookie = cookie;

  return res;
}

async function login(): Promise<{ id: string; name: string }> {
  console.log(ansi.bold('Kaizen · chat de consola'));
  console.log(ansi.dim(`conectando a ${baseUrl}\n`));

  const email = await promptVisible('Email: ');
  const password = await promptHidden('Password: ');

  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await readJson<{ message?: string }>(res, { message: `HTTP ${res.status}` });
    console.error(ansi.red(`\nNo se pudo iniciar sesión: ${body.message ?? res.statusText}`));
    process.exit(1);
  }

  return readJson<{ id: string; name: string }>(res, { id: '', name: 'socio' });
}

async function getOrCreateConversation(userName: string): Promise<string> {
  const resumeId = argValue('resume');
  if (resumeId) {
    const res = await api(`/api/conversations/${resumeId}/messages`);
    if (!res.ok) {
      console.error(ansi.red(`No pude abrir la conversación ${resumeId} (¿es tuya? ¿existe?).`));
      process.exit(1);
    }
    const { messages } = (await res.json()) as { messages: Array<{ role: string; content: unknown }> };
    console.log(ansi.dim(`--- retomando conversación ${resumeId}, ${messages.length} mensaje(s) previos ---\n`));
    for (const m of messages) {
      printStoredMessage(m.role, m.content, userName);
    }
    return resumeId;
  }

  const res = await api('/api/conversations', { method: 'POST' });
  const conversation = (await res.json()) as { id: string };
  console.log(ansi.dim(`--- conversación nueva: ${conversation.id} (usa --resume=${conversation.id} para retomarla) ---\n`));
  return conversation.id;
}

/** Imprime un mensaje ya guardado (al retomar), filtrando bloques thinking. */
function printStoredMessage(role: string, content: unknown, userName: string): void {
  if (!Array.isArray(content)) return;
  const who = role === 'user' ? ansi.cyan(userName) : ansi.green('Kaizen');
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.text === 'string') {
      console.log(`${who}: ${renderMarkdownBlock(block.text)}`);
    } else if (block.type === 'tool_use') {
      console.log(ansi.dim(`  [tool] ${block.name}`));
    }
  }
}

function parseSseEvent(chunk: string): { event: string; data: Record<string, unknown> } | null {
  const eventLine = chunk.split('\n').find((l) => l.startsWith('event:'));
  const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
  if (!eventLine || !dataLine) return null;
  try {
    return { event: eventLine.slice(6).trim(), data: JSON.parse(dataLine.slice(5).trim()) };
  } catch {
    return null;
  }
}

async function sendMessage(conversationId: string, text: string): Promise<void> {
  const res = await api(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });

  if (!res.ok || !res.body) {
    const body = await readJson<{ message?: string }>(res, { message: `HTTP ${res.status}` });
    console.error(ansi.red(`Error: ${body.message ?? res.statusText}`));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let printedAgentLabel = false;
  let lastStatus = '';

  // Los "**"/"##" del Markdown pueden llegar partidos entre dos text_delta —
  // se acumulan por línea y solo se formatean/imprimen líneas completas; la
  // línea en curso se guarda pendiente hasta el próximo '\n' o el fin del turno.
  let lineBuffer = '';
  function flushLine(final: boolean): void {
    if (!lineBuffer && !final) return;
    process.stdout.write(renderMarkdownLine(lineBuffer));
    lineBuffer = '';
  }

  process.stdout.write(`${ansi.green('Kaizen')}: `);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const raw of chunks) {
      const parsed = parseSseEvent(raw);
      if (!parsed) continue;
      const { event, data } = parsed;

      if (event === 'text_delta') {
        lineBuffer += String(data.text ?? '');
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) process.stdout.write(renderMarkdownLine(line) + '\n');
        printedAgentLabel = true;
      } else if (event === 'tool_start') {
        flushLine(true);
        if (lastStatus) process.stdout.write('\n');
        process.stdout.write(ansi.dim(`  [tool] ${data.name} — ${data.label ?? ''}\n`));
        lastStatus = String(data.name ?? '');
        if (printedAgentLabel) process.stdout.write(`${ansi.green('Kaizen')}: `);
      } else if (event === 'run_error') {
        flushLine(true);
        process.stdout.write(`\n${ansi.red(String(data.message ?? 'Error desconocido.'))}\n`);
      } else if (event === 'message_done') {
        if (data.stopReason && data.stopReason !== 'end_turn') {
          process.stdout.write(ansi.yellow(`\n  (stop_reason: ${data.stopReason})\n`));
        }
      }
    }
  }

  flushLine(true);
  process.stdout.write('\n\n');
}

async function main() {
  const partner = await login();
  console.log(ansi.dim(`sesión iniciada como ${partner.name}\n`));

  const conversationId = await getOrCreateConversation(partner.name);

  console.log(ansi.dim('escribí tu mensaje y Enter. "salir" o Ctrl+C para terminar.\n'));

  while (true) {
    const text = (await promptVisible(`${ansi.cyan(partner.name)}: `)).trim();
    if (!text) continue;
    if (text.toLowerCase() === 'salir' || text.toLowerCase() === 'exit') break;
    await sendMessage(conversationId, text);
  }

  console.log(ansi.dim('\nChau.'));
  process.exit(0);
}

main().catch((err) => {
  console.error(ansi.red('Error inesperado:'), err instanceof Error ? err.message : err);
  process.exit(1);
});
