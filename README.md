# DeepSeek Harness Desktop

Cross-platform desktop client around the official
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

Status: **Phase 0 done, Phase 1 in progress** (see
[implementation plan](https://github.com/deepseek-ai/deepseek-harness) — local copy:
`deepseek-harness-desktop-plan.optimized.md`).

## Layout

```
apps/desktop      Electron shell (main / preload / React renderer)
packages/         (future) protocol, session-store, permissions
docs/             upstream contract, product scope, IPC contract, …
tests/e2e         Playwright smoke tests
```

## Requirements

- Node.js ≥ 20 (tested 22.23.1)
- pnpm ≥ 9 (tested 11.21.0)

## Develop

```sh
pnpm install
pnpm dev            # electron-vite dev with HMR
pnpm build          # build main/preload/renderer
pnpm test:e2e       # Playwright smoke (needs `pnpm build` first)
```

## Security baseline (non-negotiable)

- `contextIsolation: true`, `nodeIntegration: false`, sandboxed preload
- Narrow preload bridge only (see `docs/ipc-contract.md`)
- Navigation guard: only the validated loopback origin may load
- API keys never in the renderer, repo, or workspace files
