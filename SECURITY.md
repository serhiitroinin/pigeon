# Security policy

## Reporting a vulnerability

Email sergey4troinin@gmail.com or open a private security advisory on this repository.
Please do not open public issues for security reports.

## How `pigeon` handles credentials

- Secrets are entered at a **hidden interactive prompt** (or piped via stdin) — never as a
  command-line argument, so they do not land in your shell history.
- They are stored in the **macOS Keychain** via the Apple-signed `/usr/bin/security` tool.
  Reads go through that stable, signed binary, so macOS does not repeatedly prompt for
  access (unlike an ad-hoc-signed compiled binary, where "Always Allow" never sticks). Each
  write recreates the item so its access-control list trusts `/usr/bin/security`.
- Non-secret config lives in `~/.config/pigeon/` with `0600` permissions.

## Known limitation

When **writing** a secret (`setup` / `login` / token refresh), the value is passed to
`security` as a `-w` argument, so it is briefly visible in that process's argument list to
**other processes running as the same user** (macOS restricts cross-user `ps`). Reads —
which are far more frequent — never expose the value in argv. A native, code-signed
credential store would remove even this brief exposure but requires an Apple Developer ID.

## Scope

macOS only — these tools depend on the macOS Keychain and `open`.
