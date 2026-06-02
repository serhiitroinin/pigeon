# Security policy

## Reporting a vulnerability

Email sergey4troinin@gmail.com or open a private security advisory on this repository.
Please do not open public issues for security reports.

## How `pigeon` handles credentials

- Secrets are entered at a **hidden interactive prompt** (or piped via stdin) — never as a
  command-line argument, so they do not land in your shell history.
- They are stored in the OS keychain via Bun's native secrets API (`Bun.secrets`, backed
  by the **macOS Keychain** through Security.framework). Secrets never touch disk in
  plaintext and never pass through a subprocess or the process argument list.
- Non-secret config lives in `~/.config/pigeon/` with `0600` permissions.

## Scope

macOS only — these tools depend on the macOS Keychain and `open`.
