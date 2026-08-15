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
| `db/` | (Phase 3) SQLite session store |
| `runtimes/` | (Task 2.3) pinned/bundled dsh runtime versions |

## Harness-owned state (`$DSH_HOME`, default `~/.dsh`)

| Path | Purpose |
|---|---|
| `profiles/web/` | Web profile composition (cordis.yml) |
| `sessions/` | Session JSONL |
| `settings.yaml` | Settings |
| (credentials) | API keys in OS-protected storage (never in renderer/repo/files) |

## Rules

- Never store API keys in app-owned files; OS-protected storage only.
- Never create ad-hoc paths; always reference this document.
- `openLogs()` opens `logs/` in the system file manager.
