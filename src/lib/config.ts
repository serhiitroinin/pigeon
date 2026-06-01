import { existsSync, mkdirSync, readFileSync, openSync, writeSync, closeSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".config", "pigeon");

export function getConfigDir(): string {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  return CONFIG_DIR;
}

export function getModuleConfigPath(module: string): string {
  return join(getConfigDir(), `${module}.json`);
}

export function readConfig<T>(module: string): T | null {
  const path = getModuleConfigPath(module);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function writeConfig<T>(module: string, data: T): void {
  const filePath = getModuleConfigPath(module);
  getConfigDir(); // ensure dir exists
  const content = JSON.stringify(data, null, 2) + "\n";
  // Open with O_WRONLY|O_CREAT|O_TRUNC and mode 0o600 — file is created
  // with correct permissions from the start, no TOCTOU window.
  const fd = openSync(filePath, "w", 0o600);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  // Ensure permissions on existing files that were opened (not created)
  chmodSync(filePath, 0o600);
}

export function requireConfig<T>(module: string): T {
  const config = readConfig<T>(module);
  if (!config) {
    throw new Error(
      `No config for "${module}". Run: ${module} setup`
    );
  }
  return config;
}
