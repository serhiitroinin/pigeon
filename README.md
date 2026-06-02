# pigeon

A terminal CLI for email — manage multiple **Gmail** and **Fastmail** accounts from your
shell. Gmail via the REST API (OAuth2), Fastmail via JMAP.

The name is the carrier pigeon. This is an unofficial third-party CLI.

## Install

```sh
brew install serhiitroinin/tap/pigeon
```

Or run from source with [Bun](https://bun.sh):

```sh
bun install
bun run src/cli.ts --help
```

## Setup

Accounts live in `~/.config/pigeon/accounts.json`. Register them, then authenticate:

```sh
pigeon accounts add s4t you@gmail.com google
pigeon accounts add fm you@fastmail.com fastmail

# Gmail: one-time OAuth2 app credentials, then per-account login
pigeon auth-setup <client-id> <redirect-uri>
pigeon auth-login s4t

# Fastmail: API token (Settings → Privacy & Security → Manage API tokens)
pigeon auth-login fm

pigeon accounts            # list accounts + auth status
```

Credentials are stored in the macOS Keychain (services: `pigeon`, `pigeon-<alias>`).

## Usage

```sh
pigeon overview                       # unread counts across all accounts
pigeon list s4t --unread              # unread inbox for an account
pigeon list all --size 5              # 5 most recent per account
pigeon read s4t <id>                  # read a full message
pigeon search all "from:github.com"   # search across accounts
pigeon archive s4t <id>               # archive
pigeon flag ae <id>                   # star/flag
pigeon trash s4t <id>                 # move to trash
```

## License

MIT
