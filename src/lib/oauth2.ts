import { getSecret, setSecret, deleteSecret } from "./keychain.ts";

export interface OAuth2Config {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
}

/** Store OAuth2 client credentials in the keychain. */
export async function saveOAuth2Credentials(
  tool: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<void> {
  await setSecret(tool, "client-id", clientId);
  await setSecret(tool, "client-secret", clientSecret);
  await setSecret(tool, "redirect-uri", redirectUri);
}

/** Load OAuth2 client credentials from the keychain. */
export async function loadOAuth2Credentials(tool: string): Promise<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}> {
  const clientId = await getSecret(tool, "client-id");
  const clientSecret = await getSecret(tool, "client-secret");
  const redirectUri = await getSecret(tool, "redirect-uri");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(`No OAuth2 credentials for "${tool}". Run: ${tool} auth-setup`);
  }
  return { clientId, clientSecret, redirectUri };
}

/** Build the OAuth2 authorization URL for the user to visit. */
export function buildAuthorizeUrl(
  config: OAuth2Config,
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: config.scopes.join(" "),
    state,
  });
  return `${config.authorizeUrl}?${params}`;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(
  config: OAuth2Config,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<OAuth2Tokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json() as Record<string, unknown>;
  if (!data.access_token) {
    const err = (data.error_description ?? data.error ?? "unknown") as string;
    throw new Error(`Token exchange failed: ${err}`);
  }

  return parseTokenResponse(data);
}

/** Refresh an access token using a refresh token. */
export async function refreshAccessToken(
  config: OAuth2Config,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<OAuth2Tokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    scope: config.scopes.join(" "),
  });

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json() as Record<string, unknown>;
  if (!data.access_token) {
    const err = (data.error_description ?? data.error ?? "unknown") as string;
    throw new Error(`Token refresh failed: ${err}. Re-authenticate with auth-login.`);
  }

  return parseTokenResponse(data, refreshToken);
}

/** Save tokens to the keychain. */
export async function saveTokens(tool: string, tokens: OAuth2Tokens): Promise<void> {
  await setSecret(tool, "access-token", tokens.accessToken);
  await setSecret(tool, "refresh-token", tokens.refreshToken);
  await setSecret(tool, "expires-at", String(tokens.expiresAt));
}

/** Load tokens from the keychain. Returns null if not logged in. */
export async function loadTokens(tool: string): Promise<OAuth2Tokens | null> {
  const accessToken = await getSecret(tool, "access-token");
  const refreshToken = await getSecret(tool, "refresh-token");
  const expiresAt = await getSecret(tool, "expires-at");
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: expiresAt ? parseInt(expiresAt, 10) : 0,
  };
}

/**
 * Get a valid access token, auto-refreshing if expired.
 *
 * @param tool             Per-account keychain namespace for tokens (e.g. "<tool>-s4t")
 * @param config           OAuth2 endpoint config
 * @param credentialsTool  Base keychain namespace for client creds. Defaults to `tool`.
 */
export async function getValidAccessToken(
  tool: string,
  config: OAuth2Config,
  credentialsTool?: string,
): Promise<string> {
  const tokens = await loadTokens(tool);
  if (!tokens) {
    throw new Error(`Not logged in. Run: ${tool} auth-login`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < tokens.expiresAt) {
    return tokens.accessToken;
  }

  // Token expired — refresh it
  const creds = await loadOAuth2Credentials(credentialsTool ?? tool);
  const refreshed = await refreshAccessToken(
    config,
    creds.clientId,
    creds.clientSecret,
    tokens.refreshToken,
  );
  await saveTokens(tool, refreshed);
  return refreshed.accessToken;
}

/** Delete all OAuth2 data from the keychain for a tool. */
export async function clearOAuth2Data(tool: string): Promise<void> {
  for (const key of ["client-id", "client-secret", "redirect-uri", "access-token", "refresh-token", "expires-at"]) {
    await deleteSecret(tool, key);
  }
}

// ── Internal ──────────────────────────────────────────────────

export function parseTokenResponse(
  data: Record<string, unknown>,
  existingRefreshToken?: string,
): OAuth2Tokens {
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Token response missing valid access_token");
  }

  const now = Math.floor(Date.now() / 1000);
  const rawExpires = data.expires_in;
  const expiresIn = typeof rawExpires === "number" ? rawExpires
    : typeof rawExpires === "string" ? parseInt(rawExpires, 10) || 3600
    : 3600;

  const rawRefresh = data.refresh_token;
  const refreshToken = (typeof rawRefresh === "string" && rawRefresh)
    ? rawRefresh
    : existingRefreshToken;
  if (!refreshToken) {
    throw new Error("No refresh token in response and no existing token to preserve");
  }

  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: now + expiresIn - 60, // 60s safety buffer
  };
}
