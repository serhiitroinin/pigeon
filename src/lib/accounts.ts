import { readConfig, writeConfig } from "./config.ts";

// ── Types ───────────────────────────────────────────────────────

export type ProviderType = "google" | "fastmail";

export interface AccountConfig {
  alias: string;
  email: string;
  provider: ProviderType;
}

// ── Config file: ~/.config/pigeon/accounts.json ─────────────────

const MODULE = "accounts";

/**
 * Load all accounts, optionally filtered by provider.
 */
export function loadAccounts(filter?: {
  provider?: ProviderType;
}): AccountConfig[] {
  const accounts = readConfig<AccountConfig[]>(MODULE) ?? [];
  if (filter?.provider) {
    return accounts.filter((a) => a.provider === filter.provider);
  }
  return accounts;
}

/**
 * Find an account by alias or email. Throws if not found.
 * Optionally filter by provider.
 */
export function resolveAccount(
  input: string,
  filter?: { provider?: ProviderType },
): AccountConfig {
  const accounts = loadAccounts(filter);
  const byAlias = accounts.find((a) => a.alias === input);
  if (byAlias) return byAlias;
  const byEmail = accounts.find((a) => a.email === input);
  if (byEmail) return byEmail;
  const valid = accounts.map((a) => a.alias).join(", ");
  throw new Error(
    `Unknown account "${input}". Valid: ${valid || "(none — run: accounts add)"}`,
  );
}

/**
 * Add an account. Throws if alias or email already exists.
 */
export function addAccount(
  alias: string,
  email: string,
  provider: ProviderType,
): void {
  const accounts = readConfig<AccountConfig[]>(MODULE) ?? [];
  if (accounts.some((a) => a.alias === alias)) {
    throw new Error(`Account alias "${alias}" already exists.`);
  }
  if (accounts.some((a) => a.email === email)) {
    throw new Error(`Account email "${email}" already exists.`);
  }
  accounts.push({ alias, email, provider });
  writeConfig(MODULE, accounts);
}

/**
 * Remove an account by alias.
 */
export function removeAccount(alias: string): void {
  const accounts = readConfig<AccountConfig[]>(MODULE) ?? [];
  const idx = accounts.findIndex((a) => a.alias === alias);
  if (idx === -1) {
    throw new Error(`Account "${alias}" not found.`);
  }
  accounts.splice(idx, 1);
  writeConfig(MODULE, accounts);
}
