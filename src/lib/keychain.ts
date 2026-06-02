// Credentials are stored in the OS keychain via Bun's native secrets API
// (macOS Keychain through Security.framework) — no secret ever passes through
// argv or a subprocess. Addresses the keychain two-dimensionally: a `tool`
// namespace (the keychain service) plus an `account` key within it.

export async function setSecret(tool: string, account: string, value: string): Promise<void> {
  await Bun.secrets.set({ service: tool, name: account, value });
}

export async function getSecret(tool: string, account: string): Promise<string | null> {
  return await Bun.secrets.get({ service: tool, name: account });
}

export async function requireSecret(tool: string, account: string): Promise<string> {
  const value = await getSecret(tool, account);
  if (value === null) {
    throw new Error(`No secret found in Keychain for "${tool}/${account}".`);
  }
  return value;
}

export async function deleteSecret(tool: string, account: string): Promise<boolean> {
  return await Bun.secrets.delete({ service: tool, name: account });
}

export async function hasSecret(tool: string, account: string): Promise<boolean> {
  return (await getSecret(tool, account)) !== null;
}
