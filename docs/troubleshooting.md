# Troubleshooting — DeepSeek Harness Desktop

> Task 5.2 deliverable. Runtime failures, recovery paths, and log locations.

## Runtime won't start

| Symptom | Cause | Fix |
|---|---|---|
| "The Harness CLI 'dsh' is missing" | dsh not on PATH (dev build) | `npm i -g @deepseek-ai/dsh`; verify `dsh --version` |
| "Node.js 20+ is required" | old Node (dev build) | upgrade Node, or use a release build (bundled runtime) |
| "Harness version mismatch" | pinned dsh ≠ installed | run the upgrade/rollback flow (Task 2.3) |
| "did not become ready within …" | slow start / port issue | retry; check `logs/dsh-runtime.log`; `dsh web --port 0` frees the port |
| Recovery screen loops | data dir unreadable | check permissions on userData `config/` + `runtimes/` |

## Logs

- Desktop app logs: `~/Library/Application Support/@dshd/desktop/logs/` (macOS),
  `%APPDATA%\@dshd\desktop\logs\` (Windows) — use **Open logs** in the UI.
- Harness runtime output is captured into `dsh-runtime.log` (rotates at 5 MB).
- Harness's own state: `~/.dsh/` (see `docs/upstream-contract.md`).

## API key issues

- Key never appears in logs/UI — masked only.
- "invalid or expired key (401/403)" → re-enter in Settings → the onboarding
  wizard validates before saving.
- Keychain unavailable → check OS keychain is unlocked; app refuses to store.

## Upgrades

- Failed upgrade auto-rolls back to the previous known-good runtime and
  restores user config from a hash-verified backup (see `upgrade-policy.md`).
- Manual rollback: follow `rollback-runbook.md`.

## Support bundle

Use the diagnostics export (T5.4) — logs + versions + config, no keys — when
reporting an issue.
