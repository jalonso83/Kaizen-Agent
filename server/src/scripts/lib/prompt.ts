// ─────────────────────────────────────────────────────────────────────────
// Helper de stdin compartido por los scripts de consola (seedPartners,
// chatCli). Códigos de teclas por punto de código, no por literal de escape
// — evita caracteres de control invisibles sueltos en el archivo fuente.
// ─────────────────────────────────────────────────────────────────────────

const KEY_EOF = String.fromCharCode(4); // Ctrl+D
const KEY_INTERRUPT = String.fromCharCode(3); // Ctrl+C
const KEY_BACKSPACE_DEL = String.fromCharCode(127); // Backspace (macOS/Linux)
const KEY_BACKSPACE_WIN = String.fromCharCode(8); // Backspace (algunos terminales Windows)

/** Pide un valor por stdin, opcionalmente sin hacer eco (para passwords). */
export function prompt(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    let value = '';

    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
    };

    const onData = (char: string) => {
      if (char === '\n' || char === '\r' || char === KEY_EOF) {
        cleanup();
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (char === KEY_INTERRUPT) {
        cleanup();
        process.exit(1);
      }
      if (char === KEY_BACKSPACE_DEL || char === KEY_BACKSPACE_WIN) {
        if (value.length > 0) {
          value = value.slice(0, -1);
          if (!opts.hidden) process.stdout.write('\b \b');
        }
        return;
      }
      value += char;
      if (!opts.hidden) process.stdout.write(char);
    };

    stdin.on('data', onData);
  });
}

export const promptHidden = (question: string) => prompt(question, { hidden: true });
export const promptVisible = (question: string) => prompt(question, { hidden: false });
