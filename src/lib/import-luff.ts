import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { setSecret } from "./keychain.ts";
import { readConfig, writeConfig } from "./config.ts";
import type { AccountConfig } from "./accounts.ts";

// Legacy luff locations.
const LUFF_ACCOUNTS = join(homedir(), ".config", "luff", "accounts.json");
const LUFF_MAIL_SERVICE = "luff-mail";

function readLuffSecret(service: string, account: string): string | null {
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { stdio: "pipe", encoding: "utf-8" },
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

export interface ImportSummary {
  accountsImported: number;
  copied: string[];
  missing: string[];
}

/**
 * One-shot migration from the legacy `luff` mail tool:
 *   1. ~/.config/luff/accounts.json  → ~/.config/pigeon/accounts.json
 *   2. OAuth app credentials  luff-mail        → pigeon
 *   3. Per-account tokens     luff-mail-<alias> → pigeon-<alias>
 *      (Google: access/refresh/expires; Fastmail: api-token)
 * Non-destructive: the luff entries are left intact.
 */
export function importFromLuff(): ImportSummary {
  const copied: string[] = [];
  const missing: string[] = [];

  // 1. Account registry — merge into any existing pigeon accounts rather than
  //    overwriting, so re-running is idempotent and pigeon-native accounts survive.
  let accounts: AccountConfig[] = [];
  if (existsSync(LUFF_ACCOUNTS)) {
    try {
      accounts = JSON.parse(readFileSync(LUFF_ACCOUNTS, "utf-8")) as AccountConfig[];
    } catch {
      /* leave accounts empty */
    }
  }
  if (accounts.length) {
    const byAlias = new Map<string, AccountConfig>();
    for (const a of readConfig<AccountConfig[]>("accounts") ?? []) byAlias.set(a.alias, a);
    for (const a of accounts) if (!byAlias.has(a.alias)) byAlias.set(a.alias, a);
    writeConfig("accounts", [...byAlias.values()]);
  }

  // 2. OAuth app credentials (shared across Google accounts).
  for (const key of ["client-id", "client-secret", "redirect-uri"]) {
    const v = readLuffSecret(LUFF_MAIL_SERVICE, key);
    if (v == null) {
      missing.push(`pigeon/${key}`);
      continue;
    }
    setSecret("pigeon", key, v);
    copied.push(`pigeon/${key}`);
  }

  // 3. Per-account tokens.
  for (const acct of accounts) {
    const src = `${LUFF_MAIL_SERVICE}-${acct.alias}`;
    const dst = `pigeon-${acct.alias}`;
    const keys = acct.provider === "fastmail"
      ? ["api-token"]
      : ["access-token", "refresh-token", "expires-at"];
    for (const key of keys) {
      const v = readLuffSecret(src, key);
      if (v == null) {
        missing.push(`${dst}/${key}`);
        continue;
      }
      setSecret(dst, key, v);
      copied.push(`${dst}/${key}`);
    }
  }

  return { accountsImported: accounts.length, copied, missing };
}
