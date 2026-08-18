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

## Session history won't open (corrupt session log)

**Symptom**: a session appears in the sidebar but clicking it shows no
history / an error; the runtime log contains `corrupt session log: seq gap in
committed region` or `corrupt Zstandard session log`.

**Cause**: multiple `dsh` instances wrote the same `session.jsonl.zstd`
concurrently (e.g. a crashed desktop run left an orphaned dsh, then a second
instance started). Each process numbers events from its own in-memory counter,
so the file ends up with a seq rewind. The data is intact — only the numbering
is broken. The reader refuses the whole file (fail-closed).

**Fix** (use the repair tool, `scripts/repair-session-log.mjs`):

```bash
# 0. STOP every dsh instance first (the tool refuses while one is running):
#    quit the desktop app, and check `ps aux | grep dsh`
# 1. preview (read-only):
node scripts/repair-session-log.mjs <session.jsonl.zstd> --dry-run
# 2. repair (backs up the original to .repair-bak, self-verifies, writes .repaired):
node scripts/repair-session-log.mjs <session.jsonl.zstd>
# 3. replace the original and restart:
mv <session.jsonl.zstd>.repaired <session.jsonl.zstd>
```

The session log lives at `~/.dsh/sessions/<workspace-key>/<session-id>/session.jsonl.zstd`
(see `docs/data-locations.md`).

**Prevention**: single-instance protection (process ledger + orphan reaping +
fixed-port reuse) is implemented in the desktop app — see
`docs/runtime-lifecycle.md`. Never run two `dsh` instances against the same
`~/.dsh` (including a manual `dsh web` while the app is running); the app
warns when it detects this (coexistence detection).

## Support bundle

Use the diagnostics export (T5.4) — logs + versions + config, no keys — when
reporting an issue.
