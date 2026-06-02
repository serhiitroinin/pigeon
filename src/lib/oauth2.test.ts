import { test, expect } from "bun:test";
import { parseTokenResponse } from "./oauth2.ts";

test("parses a full token response and applies a 60s expiry safety buffer", () => {
  const before = Math.floor(Date.now() / 1000);
  const t = parseTokenResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
  expect(t.accessToken).toBe("at");
  expect(t.refreshToken).toBe("rt");
  // expiresAt ≈ now + 3600 - 60, allow a 2s window for clock movement during the test
  expect(t.expiresAt).toBeGreaterThanOrEqual(before + 3600 - 60);
  expect(t.expiresAt).toBeLessThanOrEqual(before + 3600 - 60 + 2);
});

test("preserves an existing refresh token when the response omits one", () => {
  const t = parseTokenResponse({ access_token: "at", expires_in: 3600 }, "old-refresh");
  expect(t.refreshToken).toBe("old-refresh");
});

test("a new refresh token in the response wins over the existing one", () => {
  const t = parseTokenResponse({ access_token: "at", refresh_token: "new", expires_in: 3600 }, "old");
  expect(t.refreshToken).toBe("new");
});

test("accepts expires_in as a numeric string", () => {
  const before = Math.floor(Date.now() / 1000);
  const t = parseTokenResponse({ access_token: "at", refresh_token: "rt", expires_in: "1200" });
  expect(t.expiresAt).toBeGreaterThanOrEqual(before + 1200 - 60);
});

test("defaults expiry to 3600s when expires_in is missing", () => {
  const before = Math.floor(Date.now() / 1000);
  const t = parseTokenResponse({ access_token: "at", refresh_token: "rt" });
  expect(t.expiresAt).toBeGreaterThanOrEqual(before + 3600 - 60);
});

test("throws when access_token is missing or empty", () => {
  expect(() => parseTokenResponse({ refresh_token: "rt" })).toThrow(/access_token/);
  expect(() => parseTokenResponse({ access_token: "", refresh_token: "rt" })).toThrow();
});

test("throws when there is no refresh token and none to preserve", () => {
  expect(() => parseTokenResponse({ access_token: "at", expires_in: 3600 })).toThrow(/refresh token/);
});
