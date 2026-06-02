import { test, expect } from "bun:test";
import { mergeAccounts } from "./import-luff.ts";
import type { AccountConfig } from "./accounts.ts";

const a = (alias: string, email: string, provider: AccountConfig["provider"] = "google"): AccountConfig => ({ alias, email, provider });

test("incoming accounts with new aliases are added", () => {
  const merged = mergeAccounts([a("s4t", "s4t@x")], [a("ae", "ae@x")]);
  expect(merged.map((m) => m.alias).sort()).toEqual(["ae", "s4t"]);
});

test("on alias collision the existing account is kept (not clobbered)", () => {
  const merged = mergeAccounts([a("s4t", "existing@x")], [a("s4t", "incoming@x")]);
  expect(merged).toHaveLength(1);
  expect(merged[0]!.email).toBe("existing@x");
});

test("merging the same set twice is idempotent", () => {
  const existing = [a("s4t", "s4t@x"), a("ae", "ae@x")];
  const incoming = [a("s4t", "s4t@x"), a("ae", "ae@x")];
  const once = mergeAccounts(existing, incoming);
  const twice = mergeAccounts(once, incoming);
  expect(twice).toEqual(once);
  expect(twice).toHaveLength(2);
});

test("empty existing returns the incoming set", () => {
  expect(mergeAccounts([], [a("fm", "fm@x", "fastmail")])).toHaveLength(1);
});
