# DeepSeek Harness Desktop

Cross-platform desktop client around the official
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

Status: **all phases (0–5) implemented, 132 tests green** — see
`docs/progress.md` for the per-task tracker and remaining machine-verification
items. Implementation plan: `deepseek-harness-desktop-plan.optimized.md`.

## Layout

```
apps/desktop      Electron shell (main / preload / React renderer)
packages/         protocol, session-store, permissions, ui
docs/             upstream contract, IPC contract, release docs, …
tests/            compatibility smoke (real dsh) + event fixtures
```

## Requirements

- Node.js ≥ 20 (tested 22.23.1)
- pnpm ≥ 9 (tested 11.21.0)
- `dsh` CLI (dev builds): `npm i -g @deepseek-ai/dsh` — the app also finds it
  in the global npm bin dir if it's not on PATH.

## Develop

```sh
pnpm install
pnpm dev
```

Notes:
- `pnpm install` runs `scripts/ensure-electron.mjs`: if the Electron binary is
  missing (e.g. pnpm's postinstall failed on a network where GitHub is
  unreachable), it re-downloads it via npmmirror automatically.
- `pnpm dev` opens the window: loading screen → auto-starts the local Harness
  runtime → loads the official Web UI at its 127.0.0.1 URL. On runtime failure
  you get a recovery screen (retry / restart / logs / quit).

## Verify

```sh
pnpm test            # unit + integration (incl. real-dsh) — 132 tests
pnpm typecheck       # strict TS across all packages
pnpm test:e2e        # GUI smoke (builds first; needs a desktop session)
pnpm test:smoke      # compatibility smoke against the pinned real dsh
```

## Package (dev artifact)

```sh
pnpm --filter @dshd/desktop package
```

Requires `dsh` (PATH or global npm bin) and network access for
electron-builder's binaries (npmmirror configured in `.npmrc`).

## Security baseline (non-negotiable)

- `contextIsolation: true`, `nodeIntegration: false`, sandboxed preload
- Narrow preload bridge only (see `docs/ipc-contract.md`)
- Navigation guard: only the validated loopback origin may load
- API keys never in the renderer, repo, or workspace files
