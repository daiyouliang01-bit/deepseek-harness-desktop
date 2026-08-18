# Data Locations — DeepSeek Harness Desktop

> Task 1.4 deliverable (formalized). All desktop-owned state lives under the
> Electron `userData` directory. The Harness runtime's own state lives under
> `$DSH_HOME` (default `~/.dsh`) — see `docs/upstream-contract.md`.

## App-owned state (Electron `userData`)

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/@dshd/desktop/` |
| Windows | `%APPDATA%\@dshd\desktop\` |
| Linux | `~/.config/@dshd/desktop/` |

| Sub-path | Purpose |
|---|---|
| `logs/dsh-runtime.log` | Captured stdout/stderr of the spawned `dsh web` (rotates at 5 MB → `.1`) |
| `config/` | (Phase 3) settings, runtime manifest (Task 2.3) |
| `state/process-ledger.json` | (Task 7.1) **process ledger**: which dsh child we spawned (pid/startedAt/port/readyUrl/dshVersion) + last exit kind — the identity used for orphan reaping & instance reuse (see `docs/runtime-lifecycle.md`) |
| `db/` | (Phase 3) SQLite session store |
| `runtimes/` | (Task 2.3) pinned/bundled dsh runtime versions |

> Note: `state/process-ledger.json` (process ledger, Task 7.1) is a different
> file from `config/runtime-manifest.json` (dsh **version** upgrade manifest,
> Task 2.3) — do not confuse the two.

## Harness-owned state (`$DSH_HOME`, default `~/.dsh`)

| Path | Purpose |
|---|---|
| `profiles/web/` | Web profile composition (cordis.yml) |
| `sessions/` | Session JSONL |
| `settings.yaml` | Settings |
| (credentials) | API keys in OS-protected storage (never in renderer/repo/files) |

### Isolated DSH_HOME mode (coexistence escape hatch)

When the app detects a manual `dsh web` sharing `~/.dsh` and the user chooses
the isolated mode (plan v1.4 §3.7), the app spawns dsh with a **private
`DSH_HOME`** at `<userData>/dsh-home/` instead of `~/.dsh`. Sessions are then
fully separated from the manual instance — no shared logs, no corruption risk.
Trade-off: the app does not see sessions created under the manual instance.

## Rules

- Never store API keys in app-owned files; OS-protected storage only.
- Never create ad-hoc paths; always reference this document.
- `openLogs()` opens `logs/` in the system file manager.
