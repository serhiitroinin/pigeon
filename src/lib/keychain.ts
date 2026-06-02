import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Keychain access goes through the Apple-signed `/usr/bin/security` tool. Because
// that reader has a stable code signature, macOS's "Always Allow" persists — unlike
// an ad-hoc-signed compiled binary, which would re-prompt on every run. Items are
// addressed two-dimensionally: a `tool` namespace (the keychain service) + an
// `account` key within it.
const run = promisify(execFile);

export async function setSecret(tool: string, account: string, value: string): Promise<void> {
  // Recreate the item so its ACL trusts /usr/bin/security, keeping reads prompt-free.
  try { await run("security", ["delete-generic-password", "-s", tool, "-a", account]); } catch {}
  await run("security", ["add-generic-password", "-s", tool, "-a", account, "-w", value]);
}

export async function getSecret(tool: string, account: string): Promise<string | null> {
  try {
    const { stdout } = await run("security", ["find-generic-password", "-s", tool, "-a", account, "-w"]);
    return stdout.replace(/\n$/, "") || null;
  } catch {
    return null;
  }
}

export async function requireSecret(tool: string, account: string): Promise<string> {
  const value = await getSecret(tool, account);
  if (value === null) {
    throw new Error(`No secret found in Keychain for "${tool}/${account}".`);
  }
  return value;
}

export async function deleteSecret(tool: string, account: string): Promise<boolean> {
  try {
    await run("security", ["delete-generic-password", "-s", tool, "-a", account]);
    return true;
  } catch {
    return false;
  }
}

export async function hasSecret(tool: string, account: string): Promise<boolean> {
  return (await getSecret(tool, account)) !== null;
}
