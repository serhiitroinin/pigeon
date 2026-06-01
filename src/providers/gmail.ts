import { HttpClient } from "../lib/http.ts";
import { getValidAccessToken, type OAuth2Config } from "../lib/oauth2.ts";
import type {
  AccountConfig,
  MailProvider,
  Envelope,
  Message,
  ActionResult,
  ListOptions,
} from "../types.ts";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_OAUTH2_CONFIG: OAuth2Config = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/gmail.modify",
  ],
};

// ── Raw Gmail API types ──────────────────────────────────────────

interface GmailMessageList {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType: string;
  headers?: GmailHeader[];
  body: { size: number; data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  payload: GmailMessagePart;
  internalDate: string;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Keychain tool name per account: pigeon-s4t, pigeon-st, pigeon-ae */
function toolName(account: AccountConfig): string {
  return `pigeon-${account.alias}`;
}

async function client(account: AccountConfig): Promise<HttpClient> {
  const token = await getValidAccessToken(toolName(account), GMAIL_OAUTH2_CONFIG, "pigeon");
  return new HttpClient({
    baseUrl: BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Decode base64url-encoded string */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64);
}

/** Extract plain text body from Gmail message payload */
function extractTextBody(part: GmailMessagePart): string {
  if (part.mimeType === "text/plain" && part.body.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const child of part.parts) {
      const text = extractTextBody(child);
      if (text) return text;
    }
  }
  return "";
}

/** Get header value from message payload */
function getHeader(msg: GmailMessage, name: string): string {
  const h = msg.payload.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
  return h?.value ?? "";
}

/** Format date from internal timestamp */
function formatDate(internalDate: string): string {
  const d = new Date(parseInt(internalDate, 10));
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

/** Convert GmailMessage to Envelope */
function toEnvelope(msg: GmailMessage): Envelope {
  return {
    id: msg.id,
    from: getHeader(msg, "From"),
    to: getHeader(msg, "To"),
    date: formatDate(msg.internalDate),
    subject: getHeader(msg, "Subject"),
    isRead: !msg.labelIds.includes("UNREAD"),
    isFlagged: msg.labelIds.includes("STARRED"),
  };
}

/** Convert GmailMessage to full Message with body */
function toMessage(msg: GmailMessage): Message {
  return {
    ...toEnvelope(msg),
    body: extractTextBody(msg.payload),
  };
}

/** Fetch multiple messages in parallel */
async function fetchMessages(
  http: HttpClient,
  ids: string[],
  format: "metadata" | "full" = "metadata",
): Promise<GmailMessage[]> {
  const metadataHeaders =
    format === "metadata"
      ? "&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date"
      : "";
  const results = await Promise.all(
    ids.map((id) =>
      http.get<GmailMessage>(`/messages/${id}?format=${format}${metadataHeaders}`)
    )
  );
  return results;
}

// ── Provider ─────────────────────────────────────────────────────

export const gmailProvider: MailProvider = {
  async listMessages(account, opts) {
    const http = await client(account);
    const limit = opts?.limit ?? 20;
    const params: Record<string, string> = {
      labelIds: "INBOX",
      maxResults: String(limit),
    };
    if (opts?.unread) {
      params.q = "is:unread";
    }
    const list = await http.get<GmailMessageList>("/messages", params);
    if (!list.messages?.length) return [];
    const msgs = await fetchMessages(http, list.messages.map((m) => m.id));
    return msgs.map(toEnvelope);
  },

  async getMessage(account, id) {
    const http = await client(account);
    const msg = await http.get<GmailMessage>(`/messages/${id}?format=full`);
    return toMessage(msg);
  },

  async search(account, query, limit) {
    const http = await client(account);
    const params: Record<string, string> = {
      q: query,
      maxResults: String(limit ?? 25),
    };
    const list = await http.get<GmailMessageList>("/messages", params);
    if (!list.messages?.length) return [];
    const msgs = await fetchMessages(http, list.messages.map((m) => m.id));
    return msgs.map(toEnvelope);
  },

  async archive(account, ids) {
    const http = await client(account);
    return Promise.all(
      ids.map(async (id): Promise<ActionResult> => {
        try {
          await http.post(`/messages/${id}/modify`, {
            removeLabelIds: ["INBOX"],
          });
          return { id, ok: true };
        } catch (e) {
          return { id, ok: false, error: (e as Error).message };
        }
      })
    );
  },

  async flag(account, ids) {
    const http = await client(account);
    return Promise.all(
      ids.map(async (id): Promise<ActionResult> => {
        try {
          await http.post(`/messages/${id}/modify`, {
            addLabelIds: ["STARRED"],
          });
          return { id, ok: true };
        } catch (e) {
          return { id, ok: false, error: (e as Error).message };
        }
      })
    );
  },

  async markRead(account, ids) {
    const http = await client(account);
    return Promise.all(
      ids.map(async (id): Promise<ActionResult> => {
        try {
          await http.post(`/messages/${id}/modify`, {
            removeLabelIds: ["UNREAD"],
          });
          return { id, ok: true };
        } catch (e) {
          return { id, ok: false, error: (e as Error).message };
        }
      })
    );
  },

  async trash(account, ids) {
    const http = await client(account);
    return Promise.all(
      ids.map(async (id): Promise<ActionResult> => {
        try {
          await http.post(`/messages/${id}/trash`);
          return { id, ok: true };
        } catch (e) {
          return { id, ok: false, error: (e as Error).message };
        }
      })
    );
  },

  async unreadCount(account) {
    const http = await client(account);
    // Use Labels API for exact count (resultSizeEstimate is approximate)
    const label = await http.get<{ messagesUnread?: number }>("/labels/INBOX");
    return label.messagesUnread ?? 0;
  },
};
