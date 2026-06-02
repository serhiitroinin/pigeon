# Security policy

## Reporting a vulnerability

Email sergey4troinin@gmail.com or open a private security advisory on this repository.
Please do not open public issues for security reports.

## How `pigeon` handles credentials

- Secrets are entered at a **hidden interactive prompt** (or piped via stdin) — never as a
  command-line argument, so they do not land in your shell history.
- They are stored in the **macOS Keychain** (service `pigeon`), never written to disk in
  plaintext. Non-secret config lives in `~/.config/pigeon/` with `0600` permissions.

## Known limitation: Keychain writes via argv

Secrets are written by invoking the macOS `security` CLI with the value as the `-w`
argument. For the brief duration of that call the value is visible in the process argument
list to **other processes running as the same user** (macOS restricts cross-user `ps`).
The `security` stdin/prompt input path was evaluated but truncates values at ~128
characters, corrupting OAuth tokens, so argv is the only reliable path via that tool. A
native Keychain binding (Security.framework via FFI) would eliminate this and is a possible
future improvement.

## Scope

macOS only — these tools depend on the macOS Keychain and `open`.
