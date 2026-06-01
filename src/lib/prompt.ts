import { createInterface } from "node:readline";

/**
 * Read a secret without exposing it in argv or shell history.
 *   - Interactive TTY: hidden prompt (typed characters are not echoed).
 *   - Piped stdin (non-TTY): reads the first line, enabling
 *     `echo "$TOKEN" | <tool> setup` for scripting without argv exposure.
 */
export async function readSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const first = Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
    return first.trim();
  }

  process.stdout.write(label);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Suppress echo of typed characters while keeping newlines intact.
  const muted = rl as unknown as { _writeToOutput?: (s: string) => void };
  const original = muted._writeToOutput?.bind(rl);
  muted._writeToOutput = (s: string) => {
    if (s.includes("\n") || s.includes("\r")) original?.(s);
  };

  return new Promise<string>((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}
