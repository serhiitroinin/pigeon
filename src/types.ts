import type { AccountConfig, ProviderType } from "./lib/accounts.ts";
import { loadAccounts, resolveAccount, addAccount, removeAccount } from "./lib/accounts.ts";

export type { AccountConfig, ProviderType };
export { loadAccounts, resolveAccount, addAccount, removeAccount };

// ── Mail Provider Interface ─────────────────────────────────────

export interface ListOptions {
  unread?: boolean;
  limit?: number;
}

export interface Envelope {
  id: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  isRead: boolean;
  isFlagged: boolean;
}

export interface Message extends Envelope {
  body: string;
}

export interface ActionResult {
  id: string;
  ok: boolean;
  error?: string;
}

export interface MailProvider {
  listMessages(account: AccountConfig, opts?: ListOptions): Promise<Envelope[]>;
  getMessage(account: AccountConfig, id: string): Promise<Message>;
  search(account: AccountConfig, query: string, limit?: number): Promise<Envelope[]>;
  archive(account: AccountConfig, ids: string[]): Promise<ActionResult[]>;
  flag(account: AccountConfig, ids: string[]): Promise<ActionResult[]>;
  markRead(account: AccountConfig, ids: string[]): Promise<ActionResult[]>;
  trash(account: AccountConfig, ids: string[]): Promise<ActionResult[]>;
  unreadCount(account: AccountConfig): Promise<number>;
}
