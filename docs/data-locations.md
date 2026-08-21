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

## Harness-owned state (`$DSH_HOME`)

| Who | Path | Notes |
|---|---|---|
| Desktop app | `~/.dsh-desktop` (default; override via settings, **never** `~/.dsh`) | This app's only data dir |
| Standalone `dsh web` (:3080) | `~/.dsh` | Independent process. Desktop never writes here |

| Path under `$DSH_HOME` | Purpose |
|---|---|
| `profiles/web/` | Web profile composition (cordis.yml) |
| `sessions/` | Session JSONL |
| `settings.yaml` | Settings |
| `plugins/` / `skills/` | Desktop-local only (must be real dirs, not symlinks into `~/.dsh`) |
| (credentials) | API keys in OS-protected storage (never in renderer/repo/files) |

### Isolation rule (hard — do not weaken)

1. Desktop default is `~/.dsh-desktop`. A configured or `DSH_HOME` env value
   that equals `~/.dsh` is **rejected**.
2. On boot, any top-level symlink in the desktop home that points into
   `~/.dsh` is **copied then disconnected** (plugins / skills / files keep
   working, then the two trees diverge).
3. Desktop changes are **not** synced to :3080 unless the user explicitly asks.
4. This app does **not** modify official web UI source
   (`@deepseek-ai/dsh-client-ui-*`).
5. (2026-08-21) The desktop profile's `package.json` `file:` dependencies must
   never point into `~/.dsh` — the boot guard
   (`findProfileFileDepsIntoSharedHome` in
   `electron/runtime/dsh-home-isolation.ts`) logs an isolation violation if
   they do. Local plugin sources live in the repo at `plugins-dev/`
   (desktop-owned copy; the :3080 instance keeps its own `~/.dsh/plugins`
   copies and the two trees diverge). The `dsh-file-preview` dev plugin is
   disabled in both profiles pending a fix for its undefined `harness` API.

Historical note: isolation used to be an opt-in coexistence escape hatch
(plan v1.4 §3.7, `<userData>/dsh-home/`). That is superseded — isolation is
now the default and the only supported layout.

## Rules

- Never store API keys in app-owned files; OS-protected storage only.
- Never create ad-hoc paths; always reference this document.
- `openLogs()` opens `logs/` in the system file manager.
