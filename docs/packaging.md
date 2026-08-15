# Packaging — DeepSeek Harness Desktop

> Task 1.4 deliverable. Covers development builds today; release packaging
> (signing, auto-update, bundled runtime) lands in Phase 5 per the plan.

## Dev build (current)

Targets the current OS only, unsigned, and **requires a globally installed
`dsh` CLI** (dev machines install Node.js + `@deepseek-ai/dsh` themselves —
see `docs/upstream-contract.md`).

```sh
pnpm install
pnpm --filter @dshd/desktop build          # electron-vite: out/{main,preload,renderer}
pnpm --filter @dshd/desktop package        # electron-builder → release/
```

Output: `apps/desktop/release/` (macOS: `.dmg` + `.zip`; Windows: NSIS `.exe`
+ `.zip`).

## Release build (Phase 5)

- Pinned runtime (Node + dsh) bundled via `scripts/prepare-runtime.mjs
  --release` + electron-builder `extraResources` → end users need **no global
  Node.js** (ADR-002).
- Code signing + notarization (macOS), EV/SmartScreen story (Windows), per
  Task 5.2.
- Auto-update via electron-updater + GitHub Releases (ADR-003), client in
  Task 5.3.
- Runtime version stays separate from the app version (runtime manifest,
  Task 2.3).

## Platform notes

| Platform | Build machine | Artifacts |
|---|---|---|
| macOS | macOS (arm64 + x64) | dmg, zip |
| Windows | Windows (CI) | nsis, zip |
| Linux (later) | Linux | AppImage |

## Known limitations (dev builds)

- No bundled Node: the packaged app still needs `dsh` on PATH. Acceptable for
  dev; Gate 1 verifies "installs and runs without global Node" only once
  release bundling lands (Task 1.4 defers bundling to Task 2.3/Phase 5 —
  **deviation from plan's "prefer bundling"**: bundling is deferred to the
  runtime manifest task so the pinning/rollback machinery exists first).
