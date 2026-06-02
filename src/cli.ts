#!/usr/bin/env bun
import { Command } from "commander";
import {
  saveOAuth2Credentials,
  loadTokens,
  buildAuthorizeUrl,
  exchangeCode,
  saveTokens,
  loadOAuth2Credentials,
  getValidAccessToken,
} from "./lib/oauth2.ts";
import { HttpClient } from "./lib/http.ts";
import { setSecret, getSecret, deleteSecret } from "./lib/keychain.ts";
import * as out from "./lib/output.ts";
import { error as showError } from "./lib/output.ts";
import { readSecret } from "./lib/prompt.ts";
import { gmailProvider, GMAIL_OAUTH2_CONFIG } from "./providers/gmail.ts";
import { fastmailProvider } from "./providers/fastmail.ts";
import {
  loadAccounts,
  resolveAccount,
  addAccount,
  removeAccount,
  type AccountConfig,
  type MailProvider,
  type Envelope,
  type ActionResult,
} from "./types.ts";

// ── Provider routing ─────────────────────────────────────────────

function providerFor(account: AccountConfig): MailProvider {
  return account.provider === "fastmail" ? fastmailProvider : gmailProvider;
}

/** All pigeon accounts (both google and fastmail). */
function allAccounts(): AccountConfig[] {
  return loadAccounts();
}

// ── Formatting helpers ───────────────────────────────────────────

function cleanBody(text: string): string {
  return text
    .replace(/\[image: [^\]]*\]/g, "")
    .replace(/https?:\/\/\S{80,}/g, "[long URL]")
    .replace(/\n{3,}/g, "\n\n");
}

function fmtEnvelope(e: Envelope): string {
  const flags = [
    e.isRead ? "" : "  [unread]",
    e.isFlagged ? "  [flagged]" : "",
  ].join("");
  const date = e.date.split(" ")[0];
  return `  ${e.id}  ${date}  ${e.from}\n          ${e.subject}${flags}`;
}

// ── OAuth2 callback server ───────────────────────────────────────

async function oauthCallbackFlow(
  clientId: string,
  email: string,
  state: string,
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let redirectUri = "";
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1", // bind to loopback only — not exposed on the LAN
      fetch(req) {
        const url = new URL(req.url);
        const error = url.searchParams.get("error");
        if (error) {
          clearTimeout(timeoutId);
          reject(new Error(`OAuth2 error: ${error}`));
          setTimeout(() => server.stop(), 100);
          return new Response(`Authentication failed: ${error}. Close this tab.`, {
            headers: { "Content-Type": "text/plain" },
          });
        }
        const authCode = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        if (!authCode) {
          return new Response("Waiting for OAuth2 callback...", {
            headers: { "Content-Type": "text/plain" },
          });
        }
        if (returnedState !== state) {
          clearTimeout(timeoutId);
          reject(new Error("OAuth2 state mismatch — possible CSRF"));
          setTimeout(() => server.stop(), 100);
          return new Response("State mismatch. Authentication aborted.", {
            headers: { "Content-Type": "text/plain" },
          });
        }
        clearTimeout(timeoutId);
        resolve({ code: authCode, redirectUri });
        setTimeout(() => server.stop(), 100);
        return new Response(
          "Authenticated! You can close this tab and return to the terminal.",
          { headers: { "Content-Type": "text/plain" } },
        );
      },
    });

    redirectUri = `http://localhost:${server.port}`;
    const baseUrl = buildAuthorizeUrl(
      GMAIL_OAUTH2_CONFIG,
      clientId,
      redirectUri,
      state,
    );
    const authUrl = `${baseUrl}&access_type=offline&prompt=consent&login_hint=${encodeURIComponent(email)}`;

    out.heading(`Authorize ${email}`);
    out.info(`Callback server listening on ${redirectUri}`);
    out.blank();

    Bun.spawn(["open", authUrl]);
    console.log("Browser opened. Complete the OAuth2 consent flow...");

    timeoutId = setTimeout(() => {
      reject(new Error("OAuth2 timeout — no callback received after 2 minutes"));
      server.stop();
    }, 120_000);
  });
}

// ── Program ──────────────────────────────────────────────────────

const program = new Command();
program
  .name("pigeon")
  .description("Email CLI for Gmail and Fastmail")
  .version("0.2.0")
  .addHelpText("after", `
OVERVIEW
  Native email client using Gmail REST API and Fastmail JMAP.
  Manages 4 email accounts with short aliases for fast terminal use.
  Gmail accounts use OAuth2 (stored in macOS Keychain per account).
  Fastmail uses a static API token (stored in macOS Keychain).

COMMAND CATEGORIES
  Auth:
    auth-setup <id> <uri>            Save OAuth2 client credentials (secret prompted)
    auth-login <account>             OAuth2 flow (Gmail) or API token (Fastmail)
    accounts                         List accounts and auth status

  Read:
    overview                         Unread counts across all accounts
    list <account|all>               List inbox envelopes
    read <account> <id>              Read full message
    search <account|all> <query>     Search messages

  Write:
    archive <account> <id...>        Archive messages (remove from inbox)
    flag <account> <id...>           Star/flag messages
    trash <account> <id...>          Move to trash

  Debug:
    raw <account> <method> <path>    Direct API call

ACCOUNTS
  Stored in ~/.config/pigeon/accounts.json (not hardcoded).
  Run "pigeon accounts" to list, "pigeon accounts add" to register new accounts.

EXAMPLES
  pigeon overview                         Quick unread counts
  pigeon list s4t --unread                Unread messages for s4t
  pigeon list all --size 5                5 most recent per account
  pigeon read s4t 18e3a4b2c1d0           Read a specific message
  pigeon search all "from:github.com"    Search across all accounts
  pigeon archive s4t 18e3a4b2c1d0        Archive a message
  pigeon flag ae 18e3a4b2c1d0 18e3a...   Flag multiple messages

COMPLEMENTARY TOOLS
  strap   Health recovery and sleep data
  cadence  Training readiness, body battery, steps
`);

// ── Auth commands ────────────────────────────────────────────────

program
  .command("auth-setup <client-id> <redirect-uri>")
  .description("Save OAuth2 client credentials for Gmail accounts (client secret prompted securely)")
  .addHelpText("after", `
Details:
  Stores OAuth2 app credentials in macOS Keychain (service: pigeon).
  These are shared across all Gmail accounts — run once, not per account.
  Get credentials from Google Cloud Console > APIs & Credentials.
  The client secret is prompted securely (never passed as an argument).

  The Gmail API must be enabled in your Google Cloud project.
  Required scope: https://www.googleapis.com/auth/gmail.modify

Example:
  pigeon auth-setup 12345.apps.googleusercontent.com http://localhost:9999
`)
  .action(async (clientId: string, redirectUri: string) => {
    try {
      const clientSecret = await readSecret("Google OAuth2 client secret: ");
      if (!clientSecret) {
        showError("No client secret provided.");
        process.exit(1);
      }
      await saveOAuth2Credentials("pigeon", clientId, clientSecret, redirectUri);
      out.success("OAuth2 credentials saved for Gmail accounts.");
      out.info("Now run: pigeon auth-login <alias> for each Gmail account (s4t, st, ae)");
    } catch (e) {
      showError((e as Error).message);
      process.exit(1);
    }
  });

program
  .command("auth-login <account>")
  .description("Authenticate an account (OAuth2 for Gmail, API token for Fastmail)")
  .addHelpText("after", `
Details:
  Gmail accounts:
    Opens a browser for OAuth2 consent via a local callback server.
    Requires: pigeon auth-setup first (one-time).
    Tokens stored per account: pigeon-<alias>.

  Fastmail:
    Prompts securely for an API token. Generate one at:
    Fastmail > Settings > Privacy & Security > Manage API tokens.
    Token stored per account: pigeon-<alias> / api-token.

Examples:
  pigeon auth-login s4t       # Gmail OAuth2 flow
  pigeon auth-login fm        # Fastmail API token prompt
`)
  .action(async (accountInput: string) => {
    try {
      const account = resolveAccount(accountInput);

      if (account.provider === "fastmail") {
        const token = await readSecret("Fastmail API token: ");
        if (!token) {
          showError("No API token provided.");
          out.info("Generate one at: Fastmail > Settings > Privacy & Security > Manage API tokens");
          process.exit(1);
        }
        await setSecret(`pigeon-${account.alias}`, "api-token", token);
        out.success(`Fastmail API token saved for ${account.email}`);
        return;
      }

      // Gmail: OAuth2 flow with local callback server
      const tool = `pigeon-${account.alias}`;
      const creds = await loadOAuth2Credentials("pigeon");
      const state = crypto.randomUUID();

      // Start callback server, open browser, wait for code
      const { code, redirectUri } = await oauthCallbackFlow(
        creds.clientId,
        account.email,
        state,
      );

      const tokens = await exchangeCode(
        GMAIL_OAUTH2_CONFIG,
        creds.clientId,
        creds.clientSecret,
        redirectUri,
        code,
      );
      await saveTokens(tool, tokens);
      out.success(`Authenticated ${account.email} (tokens saved as ${tool})`);
    } catch (e) {
      showError((e as Error).message);
      process.exit(1);
    }
  });

const accountsCmd = program
  .command("accounts")
  .description("Manage configured accounts")
  .addHelpText("after", `
Details:
  Lists accounts from ~/.config/pigeon/accounts.json and their auth status.
  Use "accounts add" to register a new account.
  Use "accounts remove" to unregister an account.

Subcommands:
  accounts              List all accounts + auth status
  accounts add          Add a new account
  accounts remove       Remove an account
`);

accountsCmd
  .command("list", { isDefault: true })
  .description("List accounts and authentication status")
  .action(async () => {
    const accounts = allAccounts();
    if (!accounts.length) {
      out.info("No accounts configured. Run: pigeon accounts add <alias> <email> <provider>");
      return;
    }
    const rows = await Promise.all(accounts.map(async (a) => {
      let auth = "MISSING";
      if (a.provider === "fastmail") {
        auth = (await getSecret(`pigeon-${a.alias}`, "api-token")) ? "OK" : "MISSING";
      } else {
        const tokens = await loadTokens(`pigeon-${a.alias}`);
        auth = tokens ? "OK" : "MISSING";
      }
      return [a.alias, a.email, a.provider, auth];
    }));
    out.table(["Alias", "Email", "Provider", "Auth"], rows);
  });

accountsCmd
  .command("add <alias> <email> <provider>")
  .description("Add a new account (provider: google or fastmail)")
  .action(async (alias: string, email: string, provider: string) => {
    try {
      if (provider !== "google" && provider !== "fastmail") {
        showError(`Invalid provider "${provider}". Use: google, fastmail`);
        process.exit(1);
      }
      addAccount(alias, email, provider);
      out.success(`Account "${alias}" (${email}) added.`);
      out.info(`Next: pigeon auth-login ${alias}`);
    } catch (e) {
      showError((e as Error).message);
      process.exit(1);
    }
  });

accountsCmd
  .command("remove <alias>")
  .description("Remove an account and purge its Keychain credentials")
  .action(async (alias: string) => {
    try {
      const account = resolveAccount(alias);
      removeAccount(account.alias);
      // Also purge the account's Keychain entries so no orphan secrets remain.
      const tool = `pigeon-${account.alias}`;
      if (account.provider === "fastmail") {
        await deleteSecret(tool, "api-token");
      } else {
        for (const key of ["access-token", "refresh-token", "expires-at"]) {
          await deleteSecret(tool, key);
        }
      }
      out.success(`Account "${account.alias}" removed and Keychain credentials purged.`);
    } catch (e) {
      showError((e as Error).message);
      process.exit(1);
    }
  });

// ── Read commands ────────────────────────────────────────────────

program
  .command("overview")
  .description("Unread counts across all accounts")
  .addHelpText("after", `
Details:
  Checks all accounts in parallel and reports unread message count.
  Failed connections show ERR instead of a count.

Columns:
  Alias   Account short name
  Email   Full address
  Unread  Number of unread messages in inbox

Example:
  pigeon overview
  # s4t   sergey4troinin@gmail.com         3 unread
  # st    serhiitroinin@gmail.com          0 unread
  # ae    sergey.troynin@agileengine.com   12 unread
  # fm    serhiitroinin@fastmail.com       1 unread
`)
  .action(async () => {
    out.heading("Email Overview");
    out.blank();

    const accounts = allAccounts();
    const results = await Promise.allSettled(
      accounts.map(async (account) => {
        const provider = providerFor(account);
        const count = await provider.unreadCount(account);
        return { account, count };
      })
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const account = accounts[i]!;
      if (result.status === "fulfilled") {
        console.log(
          `  ${account.alias.padEnd(4)}  ${account.email.padEnd(38)}  ${result.value.count} unread`
        );
      } else {
        console.log(
          `  ${account.alias.padEnd(4)}  ${account.email.padEnd(38)}  ERR`
        );
      }
    }
  });

program
  .command("list <account>")
  .description("List inbox envelopes")
  .option("--unread", "Show only unread messages")
  .option("--size <n>", "Number of messages to fetch", "20")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Details:
  Lists envelopes from the inbox. Use "all" to list from every account.

  Output per message:
    ID        Message identifier (use with read/archive/flag/trash)
    Date      Date received (YYYY-MM-DD)
    From      Sender name or address
    Subject   Message subject line
    Flags     [unread] and/or [flagged] markers

Options:
  --unread    Only show messages not yet marked as read
  --size N    Limit results (default 20, max varies by provider)
  --json      Output raw envelope data as JSON

Examples:
  pigeon list s4t                    Last 20 inbox messages
  pigeon list s4t --unread           Only unread
  pigeon list all --size 5           5 most recent per account
  pigeon list st --json              Raw JSON output
`)
  .action(async (accountInput: string, opts: { unread?: boolean; size?: string; json?: boolean }) => {
    const limit = parseInt(opts.size ?? "20", 10);

    if (accountInput === "all") {
      for (const account of allAccounts()) {
        await listAccount(account, { unread: opts.unread, limit }, opts.json);
        out.blank();
      }
    } else {
      const account = resolveAccount(accountInput);
      await listAccount(account, { unread: opts.unread, limit }, opts.json);
    }
  });

async function listAccount(
  account: AccountConfig,
  opts: { unread?: boolean; limit: number },
  jsonOutput?: boolean,
): Promise<void> {
  try {
    const provider = providerFor(account);
    const envelopes = await provider.listMessages(account, opts);

    if (jsonOutput) {
      out.json(envelopes);
      return;
    }

    console.log(`[${account.alias}] ${account.email} — INBOX`);
    out.blank();

    if (!envelopes.length) {
      console.log(opts.unread ? "  No unread messages." : "  No messages.");
      return;
    }

    for (const e of envelopes) {
      console.log(fmtEnvelope(e));
    }
  } catch (e) {
    console.log(`[${account.alias}] ERROR: ${(e as Error).message}`);
  }
}

program
  .command("read <account> <id>")
  .description("Read a full message")
  .option("--raw", "Show raw body without cleanup")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Details:
  Fetches and displays a full email message including headers and body.
  By default, the body is cleaned up:
    - [image: ...] markers are stripped
    - URLs longer than 80 characters are replaced with [long URL]
    - Excessive blank lines are collapsed

Options:
  --raw     Show the original body without cleanup
  --json    Output the full message as JSON

Examples:
  pigeon read s4t 18e3a4b2c1d0          Read with cleanup
  pigeon read s4t 18e3a4b2c1d0 --raw    Read raw body
  pigeon read fm M12345 --json           JSON output
`)
  .action(async (accountInput: string, id: string, opts: { raw?: boolean; json?: boolean }) => {
    try {
      const account = resolveAccount(accountInput);
      const provider = providerFor(account);
      const msg = await provider.getMessage(account, id);

      if (opts.json) {
        out.json(msg);
        return;
      }

      console.log(`[${account.alias}] Message ${id}`);
      console.log("────────────────────────────────────────");
      console.log(`From:    ${msg.from}`);
      console.log(`To:      ${msg.to}`);
      console.log(`Date:    ${msg.date}`);
      console.log(`Subject: ${msg.subject}`);
      console.log("────────────────────────────────────────");
      out.blank();
      console.log(opts.raw ? msg.body : cleanBody(msg.body));
    } catch (e) {
      showError((e as Error).message);
      process.exit(1);
    }
  });

program
  .command("search <account> <query>")
  .description("Search messages")
  .option("--size <n>", "Max results", "25")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Details:
  Searches messages across the account. Use "all" for every account.

  Gmail search syntax (s4t, st, ae):
    from:sender@example.com     Messages from a specific sender
    subject:invoice             Subject contains "invoice"
    has:attachment               Messages with attachments
    after:2026/02/01            Messages after a date
    is:unread                   Unread messages
    label:important             Messages with a label
    "exact phrase"              Exact phrase match

  Fastmail search (fm):
    Uses JMAP text search — matches subject, from, body text.

Examples:
  pigeon search s4t "from:github.com"          GitHub notifications
  pigeon search all "subject:invoice"          Invoices everywhere
  pigeon search ae "has:attachment after:2026/02/01"
  pigeon search fm "project update"
`)
  .action(async (accountInput: string, query: string, opts: { size?: string; json?: boolean }) => {
    const limit = parseInt(opts.size ?? "25", 10);

    if (accountInput === "all") {
      for (const account of allAccounts()) {
        await searchAccount(account, query, limit, opts.json);
        out.blank();
      }
    } else {
      const account = resolveAccount(accountInput);
      await searchAccount(account, query, limit, opts.json);
    }
  });

async function searchAccount(
  account: AccountConfig,
  query: string,
  limit: number,
  jsonOutput?: boolean,
): Promise<void> {
  try {
    const provider = providerFor(account);
    const envelopes = await provider.search(account, query, limit);

    if (jsonOutput) {
      out.json(envelopes);
      return;
    }

    console.log(`[${account.alias}] ${account.email} — Search results`);
    out.blank();

    if (!envelopes.length) {
      console.log("  No results.");
      return;
    }

    for (const e of envelopes) {
      console.log(fmtEnvelope(e));
    }
  } catch (e) {
    console.log(`[${account.alias}] ERROR: ${(e as Error).message}`);
  }
}

// ── Write commands ───────────────────────────────────────────────

program
  .command("archive <account> <ids...>")
  .description("Archive messages (remove from inbox)")
  .addHelpText("after", `
Details:
  Gmail:    Removes the INBOX label (message stays in All Mail).
  Fastmail: Moves from Inbox to Archive mailbox.

  Multiple message IDs can be provided — they're processed in parallel.

Examples:
  pigeon archive s4t 18e3a4b2c1d0
  pigeon archive ae 18e3a4b2c1d0 18e3a4b2c1d1 18e3a4b2c1d2
`)
  .action(async (accountInput: string, ids: string[]) => {
    try {
      const account = resolveAccount(accountInput);
      const provider = providerFor(account);
      const results = await provider.archive(account, ids);
      for (const r of results) {
        console.log(
          `[${account.alias}] ${r.id} → ${r.ok ? "archived" : `ERROR: ${r.error}`}`
        );
      }
    } catch (e) {
      showError((e as Error).message);
      process.exit(1);
    }
  });

program
  .command("flag <account> <ids...>")
  .description("Star/flag messages")
  .addHelpText("after", `
Details:
  Gmail:    Adds the STARRED label.
  Fastmail: Sets the $flagged keyword.

Examples:
  pigeon flag s4t 18e3a4b2c1d0
  pigeon flag fm M12345 M12346
`)
  .action(async (accountInput: string, ids: string[]) => {
    try {
      const account = resolveAccount(accountInput);
      const provider = providerFor(account);
      const results = await provider.flag(account, ids);
      for (const r of results) {
        console.log(
          `[${account.alias}] ${r.id} → ${r.ok ? "flagged" : `ERROR: ${r.error}`}`
        );
      }
    } catch (e) {
      showError((e as Error).message);
      process.exit(1);
    }
  });

program
  .command("trash <account> <ids...>")
  .description("Move messages to trash")
  .addHelpText("after", `
Details:
  Gmail:    Moves to Trash (auto-deleted after 30 days).
  Fastmail: Moves from current mailbox to Trash.

  Does NOT permanently delete — messages can be recovered from Trash.

Examples:
  pigeon trash s4t 18e3a4b2c1d0
  pigeon trash fm M12345
`)
  .action(async (accountInput: string, ids: string[]) => {
    try {
      const account = resolveAccount(accountInput);
      const provider = providerFor(account);
      const results = await provider.trash(account, ids);
      for (const r of results) {
        console.log(
          `[${account.alias}] ${r.id} → ${r.ok ? "trashed" : `ERROR: ${r.error}`}`
        );
      }
    } catch (e) {
      showError((e as Error).message);
      process.exit(1);
    }
  });

// ── Raw API command ──────────────────────────────────────────────

program
  .command("raw <account> <method> <path>")
  .description("Direct API call for debugging")
  .addHelpText("after", `
Details:
  Makes a raw HTTP request to the account's API and prints the JSON response.
  Useful for debugging or accessing endpoints not exposed by other commands.

  Gmail:    method = GET/POST, path relative to /gmail/v1/users/me
  Fastmail: method = ignored (always POST), path = JMAP method name

Examples:
  pigeon raw s4t GET /messages?maxResults=1
  pigeon raw s4t GET /labels
  pigeon raw fm POST "Email/query"
`)
  .action(async (accountInput: string, method: string, path: string) => {
    try {
      const account = resolveAccount(accountInput);

      if (account.provider === "google") {
        const token = await getValidAccessToken(
          `pigeon-${account.alias}`,
          GMAIL_OAUTH2_CONFIG,
          "pigeon",
        );
        const http = new HttpClient({
          baseUrl: "https://gmail.googleapis.com/gmail/v1/users/me",
          headers: { Authorization: `Bearer ${token}` },
        });
        const result = await http.request(path, { method: method.toUpperCase() });
        out.json(result);
      } else {
        out.info("Fastmail raw: use JMAP method calls via the provider directly.");
        out.info("This command currently supports Gmail accounts only.");
      }
    } catch (e) {
      showError((e as Error).message);
      process.exit(1);
    }
  });

// ── Run ──────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((e) => {
  showError((e as Error).message);
  process.exit(1);
});
