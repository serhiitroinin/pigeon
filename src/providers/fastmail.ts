import { getSecret } from "../lib/keychain.ts";
import type {
  AccountConfig,
  MailProvider,
  Envelope,
  Message,
  ActionResult,
  ListOptions,
} from "../types.ts";

const SESSION_URL = "https://api.fastmail.com/jmap/session";

// ── JMAP types ───────────────────────────────────────────────────

interface JmapSession {
  apiUrl: string;
  primaryAccounts: Record<string, string>;
}

interface JmapMailbox {
  id: string;
  name: string;
  role: string | null;
}

interface JmapEmailAddress {
  name: string | null;
  email: string;
}

interface JmapEmail {
  id: string;
  subject: string;
  from: JmapEmailAddress[] | null;
  to: JmapEmailAddress[] | null;
  receivedAt: string;
  keywords: Record<string, boolean>;
  mailboxIds: Record<string, boolean>;
}

interface JmapEmailFull extends JmapEmail {
  textBody: { partId: string }[];
  bodyValues: Record<string, { value: string }>;
}

interface JmapResponse {
  methodResponses: [string, Record<string, unknown>, string][];
}

function jmapResult(resp: JmapResponse, index: number, tag: string): Record<string, unknown> {
  const entry = resp.methodResponses[index];
  if (!entry) {
    throw new Error(`JMAP: expected response at index ${index} (tag: ${tag}), got ${resp.methodResponses.length} responses`);
  }
  const [method, result] = entry;
  if (method === "error") {
    const errType = (result as Record<string, unknown>).type ?? "unknown";
    throw new Error(`JMAP error in ${tag}: ${errType}`);
  }
  return result;
}

// ── Per-account session & mailbox caches ─────────────────────────
// Keyed by account alias so multiple Fastmail accounts never collide.

const sessionCache = new Map<string, { apiUrl: string; accountId: string }>();
const mailboxCache = new Map<string, Map<string, string>>(); // alias → (role → id)

/** Read the API token for a specific account (Keychain: pigeon-<alias> / api-token). */
function getToken(account: AccountConfig): string {
  const token = getSecret(`pigeon-${account.alias}`, "api-token");
  if (!token) {
    throw new Error(`No Fastmail API token for "${account.alias}". Run: pigeon auth-login ${account.alias}`);
  }
  return token;
}

async function getSession(account: AccountConfig): Promise<{ apiUrl: string; accountId: string }> {
  const cached = sessionCache.get(account.alias);
  if (cached) return cached;

  const token = getToken(account);
  const res = await fetch(SESSION_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`JMAP session failed: HTTP ${res.status}`);
  }
  const session = (await res.json()) as JmapSession;
  const accountId =
    session.primaryAccounts["urn:ietf:params:jmap:mail"] ??
    Object.values(session.primaryAccounts)[0];
  if (!accountId) throw new Error("No JMAP mail account found");
  const value = { apiUrl: session.apiUrl, accountId };
  sessionCache.set(account.alias, value);
  return value;
}

async function jmapCall(account: AccountConfig, methodCalls: unknown[][]): Promise<JmapResponse> {
  const { apiUrl } = await getSession(account);
  const token = getToken(account);
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`JMAP call failed: HTTP ${res.status} ${text}`);
  }
  return res.json() as Promise<JmapResponse>;
}

async function getMailboxId(account: AccountConfig, role: string): Promise<string> {
  const cached = mailboxCache.get(account.alias);
  if (cached) {
    const id = cached.get(role);
    if (id) return id;
  }

  const { accountId } = await getSession(account);
  const resp = await jmapCall(account, [
    ["Mailbox/get", { accountId, properties: ["id", "name", "role"] }, "mb"],
  ]);
  const result = jmapResult(resp, 0, "Mailbox/get");
  const mailboxes = (result.list as JmapMailbox[]) ?? [];

  const byRole = new Map<string, string>();
  for (const mb of mailboxes) {
    if (mb.role) byRole.set(mb.role, mb.id);
  }
  mailboxCache.set(account.alias, byRole);

  const id = byRole.get(role);
  if (!id) throw new Error(`No mailbox with role "${role}" found`);
  return id;
}

// ── Helpers ──────────────────────────────────────────────────────

function formatAddr(addrs: JmapEmailAddress[] | null): string {
  if (!addrs?.length) return "";
  const a = addrs[0]!;
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

function toEnvelope(email: JmapEmail): Envelope {
  return {
    id: email.id,
    from: formatAddr(email.from),
    to: formatAddr(email.to),
    date: email.receivedAt.replace("T", " ").replace(/\.\d+Z$/, "").replace("Z", ""),
    subject: email.subject ?? "(no subject)",
    isRead: !!email.keywords?.["$seen"],
    isFlagged: !!email.keywords?.["$flagged"],
  };
}

// ── Provider ─────────────────────────────────────────────────────

export const fastmailProvider: MailProvider = {
  async listMessages(account, opts) {
    const { accountId } = await getSession(account);
    const inboxId = await getMailboxId(account, "inbox");
    const limit = opts?.limit ?? 20;

    const filter: Record<string, unknown> = { inMailbox: inboxId };
    if (opts?.unread) {
      filter.notKeyword = "$seen";
    }

    const resp = await jmapCall(account, [
      [
        "Email/query",
        {
          accountId,
          filter,
          sort: [{ property: "receivedAt", isAscending: false }],
          limit,
        },
        "q",
      ],
      [
        "Email/get",
        {
          accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: ["id", "subject", "from", "to", "receivedAt", "keywords", "mailboxIds"],
        },
        "g",
      ],
    ]);

    const getResult = jmapResult(resp, 1, "Email/get");
    const emails = (getResult.list as JmapEmail[]) ?? [];
    return emails.map(toEnvelope);
  },

  async getMessage(account, id) {
    const { accountId } = await getSession(account);
    const resp = await jmapCall(account, [
      [
        "Email/get",
        {
          accountId,
          ids: [id],
          properties: [
            "id", "subject", "from", "to", "receivedAt", "keywords",
            "mailboxIds", "textBody", "bodyValues",
          ],
          fetchAllBodyValues: true,
        },
        "g",
      ],
    ]);

    const result = jmapResult(resp, 0, "Email/get");
    const emails = (result.list as JmapEmailFull[]) ?? [];
    if (!emails.length) throw new Error(`Message ${id} not found`);

    const email = emails[0]!;
    const bodyParts = email.textBody ?? [];
    const body = bodyParts
      .map((p) => email.bodyValues?.[p.partId]?.value ?? "")
      .join("\n");

    return {
      ...toEnvelope(email),
      body,
    };
  },

  async search(account, query, limit) {
    const { accountId } = await getSession(account);
    const resp = await jmapCall(account, [
      [
        "Email/query",
        {
          accountId,
          filter: { text: query },
          sort: [{ property: "receivedAt", isAscending: false }],
          limit: limit ?? 25,
        },
        "q",
      ],
      [
        "Email/get",
        {
          accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: ["id", "subject", "from", "to", "receivedAt", "keywords", "mailboxIds"],
        },
        "g",
      ],
    ]);

    const getResult = jmapResult(resp, 1, "Email/get");
    const emails = (getResult.list as JmapEmail[]) ?? [];
    return emails.map(toEnvelope);
  },

  async archive(account, ids) {
    const { accountId } = await getSession(account);
    const inboxId = await getMailboxId(account, "inbox");
    const archiveId = await getMailboxId(account, "archive");

    const update: Record<string, unknown> = {};
    for (const id of ids) {
      update[id] = {
        [`mailboxIds/${inboxId}`]: null,
        [`mailboxIds/${archiveId}`]: true,
      };
    }

    const resp = await jmapCall(account, [
      ["Email/set", { accountId, update }, "s"],
    ]);

    const result = jmapResult(resp, 0, "Email/set");
    const notUpdated = result.notUpdated as Record<string, { type: string }> | null;

    return ids.map((id): ActionResult => {
      if (notUpdated?.[id]) {
        return { id, ok: false, error: notUpdated[id]!.type };
      }
      return { id, ok: true };
    });
  },

  async flag(account, ids) {
    const { accountId } = await getSession(account);
    const update: Record<string, unknown> = {};
    for (const id of ids) {
      update[id] = { "keywords/$flagged": true };
    }

    const resp = await jmapCall(account, [
      ["Email/set", { accountId, update }, "s"],
    ]);

    const result = jmapResult(resp, 0, "Email/set");
    const notUpdated = result.notUpdated as Record<string, { type: string }> | null;

    return ids.map((id): ActionResult => {
      if (notUpdated?.[id]) {
        return { id, ok: false, error: notUpdated[id]!.type };
      }
      return { id, ok: true };
    });
  },

  async markRead(account, ids) {
    const { accountId } = await getSession(account);
    const update: Record<string, unknown> = {};
    for (const id of ids) {
      update[id] = { "keywords/$seen": true };
    }

    const resp = await jmapCall(account, [
      ["Email/set", { accountId, update }, "s"],
    ]);

    const result = jmapResult(resp, 0, "Email/set");
    const notUpdated = result.notUpdated as Record<string, { type: string }> | null;

    return ids.map((id): ActionResult => {
      if (notUpdated?.[id]) {
        return { id, ok: false, error: notUpdated[id]!.type };
      }
      return { id, ok: true };
    });
  },

  async trash(account, ids) {
    const { accountId } = await getSession(account);
    const inboxId = await getMailboxId(account, "inbox");
    const trashId = await getMailboxId(account, "trash");

    const update: Record<string, unknown> = {};
    for (const id of ids) {
      update[id] = {
        [`mailboxIds/${inboxId}`]: null,
        [`mailboxIds/${trashId}`]: true,
      };
    }

    const resp = await jmapCall(account, [
      ["Email/set", { accountId, update }, "s"],
    ]);

    const result = jmapResult(resp, 0, "Email/set");
    const notUpdated = result.notUpdated as Record<string, { type: string }> | null;

    return ids.map((id): ActionResult => {
      if (notUpdated?.[id]) {
        return { id, ok: false, error: notUpdated[id]!.type };
      }
      return { id, ok: true };
    });
  },

  async unreadCount(account) {
    const { accountId } = await getSession(account);
    // Use Mailbox/get for exact unread count (same as IMAP \Unseen)
    const resp = await jmapCall(account, [
      ["Mailbox/get", { accountId, properties: ["id", "role", "unreadEmails"] }, "mb"],
    ]);
    const result = jmapResult(resp, 0, "Mailbox/get");
    const mailboxes = (result.list as { id: string; role: string | null; unreadEmails: number }[]) ?? [];
    const inbox = mailboxes.find((m) => m.role === "inbox");
    return inbox?.unreadEmails ?? 0;
  },
};
