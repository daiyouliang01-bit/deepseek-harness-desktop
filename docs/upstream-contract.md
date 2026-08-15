# Upstream Contract — `deepseek-ai/deepseek-harness`

> Task 0.1 deliverable. Records everything the desktop app may rely on from the
> upstream Harness. Anything not confirmed from source is marked **UNKNOWN** and
> must be verified before the corresponding feature depends on it.
>
> Last verified: 2026-08-16 · Verified against: official GitHub repo, local npm
> install (`@deepseek-ai/dsh@0.1.0-rc.6`), live `dsh --help` / `dsh web --help` output.

## Repository

| Field | Value |
|---|---|
| Official repo | https://github.com/deepseek-ai/deepseek-harness |
| Description | "DeepSeek Harness: Everything is a Plugin." — an agent harness powered by [Cordis](https://github.com/cordiverse/cordis) |
| License | MIT (dependencies disclosed in `THIRD_PARTY_NOTICES.md`) |
| Maturity | **Developer preview** — README states "THERE WILL BE COMPATIBILITY-BREAKING CHANGES." |
| npm package | `@deepseek-ai/dsh` (CLI, `bin: dsh`) |

## Tested runtime

| Field | Value |
|---|---|
| dsh version | `0.1.0-rc.6` (installed globally at `/Users/litong/node_modules/@deepseek-ai/dsh`) |
| Node.js | `v22.23.1` (tested locally; package engines **UNKNOWN** — verify before pinning a floor) |
| pnpm | `11.21.0` (tested locally; upstream repo uses pnpm workspaces) |
| Source install | `git clone … && pnpm install && pnpm run build && pnpm dsh web` (official README) |
| npm install | `npx @deepseek-ai/dsh web` |

## `dsh web` startup contract (verified from `--help`)

```
Usage: dsh --profile web [options]   (alias: dsh web)

Options:
  --host <host>                   bind host
  --port <port>                   listen port; pass 0 to let the OS pick a free one
  --trusted-host <authority...>   extra authority the /api browser-trust fence accepts
  -h, --help                      show this help
```

- Default endpoint: `http://127.0.0.1:3080` (official README).
- `--port 0` lets the OS pick a free port → **the desktop wrapper must use this**
  (ADR-007) because another Harness instance may already hold 3080 — e.g. the
  deployment this plan was written on.
- `--host` binds a specific interface; the wrapper should always bind `127.0.0.1`.
- Profile layout: `$DSH_HOME/profiles/web/` contains `cordis.yml`,
  `cordis.patch.yml`, `package.json`, `pnpm-workspace.yaml`. Default
  `$DSH_HOME` = `~/.dsh`.
- The web profile is a Cordis composition: everything is a plugin row
  (`dsh-base`, `dsh-web-app`, sandbox, approval, persistence, …).
- `--dump-default-config` prints the composed profile tree (used for
  compatibility checks later).

## Data / config locations (as observed locally)

| What | Location |
|---|---|
| DSH home | `~/.dsh` (default; `DSH_HOME` env overrides — **UNKNOWN** exact precedence, assume env wins) |
| Web profile | `~/.dsh/profiles/web/` |
| Sessions | `~/.dsh/sessions/` (JSONL persistence plugin) |
| Credentials | local credentials plugin (`dsh-credentials-local`) — API keys live in OS-protected storage, **never in the renderer** (aligns with our constraints) |
| Settings | `settings.yaml` under `~/.dsh` |
| Telemetry | disabled by default (`DSH_TELEMETRY_MODE` env; exporter URL defaults to `https://harness-telemetry.deepseeksvc.com/v1/logs` when enabled) |

## Behavioral notes (observed / to confirm)

- The web UI exposes an `/api` endpoint protected by a "browser-trust fence";
  `--trusted-host` adds authorities accepted by that fence. The wrapper's
  window origin must be inside the fence for API calls to work — **VERIFY when
  Task 1.3 loads the UI** (may need `--trusted-host 127.0.0.1` or the app's own
  origin).
- Sandbox/approval behavior is configurable via `DSH_PERMISSION_MODE`
  (`read-only` | `workspace-write` | `danger-full-access`); the desktop app must
  default to a restricted mode and surface approvals (Phase 4).
- `dsh web` is an alias for `--profile web`; other profiles exist
  (`headless`, `tui`). The desktop app targets the **web** profile only.

## Developer-preview risks (recorded per plan)

1. CLI flags / output format may change between releases → parse the ready URL
   defensively and prefer `--port 0` + health probe (Task 1.2 dual-channel).
2. Web UI internals and `/api` fence may change → the desktop shell must never
   depend on Harness internals; only on `dsh web` + the loopback HTTP surface.
3. Node version floor may move → compatibility check (Task 2.2) covers it.
4. Breaking changes ship fast → pin the runtime version (Task 2.3 manifest) and
   gate every upgrade behind the smoke suite (Task 5.1).

## Open items (UNKNOWN, to verify)

- Exact Node engines floor in `@deepseek-ai/dsh/package.json`.
- Whether `--trusted-host` is required for the wrapper's window origin.
- Exact startup stdout shape when ready (to be captured empirically in Task 1.2).
- Default CSP headers served by the web app (relevant for our renderer CSP).
