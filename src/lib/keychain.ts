import { execFileSync } from "node:child_process";

// pigeon addresses the Keychain two-dimensionally: a `tool` namespace
// (e.g. "pigeon" for app creds, "pigeon-s4t" for a Google account's tokens,
// "pigeon-fm" for the Fastmail token) plus an `account` key within it.
// The service name IS the tool — no extra prefix.
function serviceName(tool: string): string {
  return tool;
}

/**
 * Store a secret in macOS Keychain.
 * Uses `security add-generic-password` with -U (update if exists).
 */
export function setSecret(tool: string, account: string, value: string): void {
  const service = serviceName(tool);
  try {
    // Pass the secret via argv (-w value): macOS `security` reading the password from
    // a stdin/tty prompt truncates at ~128 chars, which silently corrupts OAuth tokens.
    execFileSync("security", [
      "add-generic-password", "-s", service, "-a", account, "-w", value, "-U",
    ], { stdio: "pipe" });
  } catch (e: unknown) {
    throw new Error(
      `Failed to store secret in Keychain (service=${service}, account=${account}): ${(e as Error).message}`
    );
  }
}

/**
 * Retrieve a secret from macOS Keychain. Returns null if not found.
 */
export function getSecret(tool: string, account: string): string | null {
  const service = serviceName(tool);
  try {
    const result = execFileSync("security", [
      "find-generic-password", "-s", service, "-a", account, "-w",
    ], { stdio: "pipe", encoding: "utf-8" });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Retrieve a secret, throwing if not found.
 */
export function requireSecret(tool: string, account: string): string {
  const value = getSecret(tool, account);
  if (value === null) {
    throw new Error(
      `No secret found in Keychain for "${tool}/${account}".`
    );
  }
  return value;
}

/**
 * Delete a secret from macOS Keychain. Returns true if deleted.
 */
export function deleteSecret(tool: string, account: string): boolean {
  const service = serviceName(tool);
  try {
    execFileSync("security", [
      "delete-generic-password", "-s", service, "-a", account,
    ], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a secret exists in Keychain without retrieving it.
 */
export function hasSecret(tool: string, account: string): boolean {
  return getSecret(tool, account) !== null;
}
