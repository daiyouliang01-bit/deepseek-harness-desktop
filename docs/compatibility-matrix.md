# Compatibility Matrix — DeepSeek Harness Desktop

> Task 2.2 deliverable. Records the tested combinations of OS × Node × dsh and
> the app's recovery guidance for each failure class. Run by
> `runCompatibilityChecks()` before the main UI opens.

## Version policy

- **dsh**: pinned by the app (runtime manifest, Task 2.3). Compatibility
  requires identical `major.minor`; patch/`-rc` differences are tolerated
  (pre-1.0 releases treat the minor as significant).
- **Node**: floor `>= 20` (tested on 22.23.1). Bundled runtime in release
  builds removes the requirement for end users (ADR-002).

## Matrix (tested / expected)

| OS | Node | dsh | Status | Notes |
|---|---|---|---|---|
| macOS 26 (arm64) | 22.23.1 | 0.1.1-rc.2 | ✅ tested | 2026-08-21: harness-smoke 5/5 (real startup/HTTP/restart/persistence) + full unit suite 258 green; bundled runtime synced |
| macOS 26 (arm64) | 22.23.1 | 0.1.0-rc.8 | ✅ tested | previous pin; backup at `~/.dsh-desktop.backup-20260821` |
| macOS | ≥ 20 | same minor | ✅ expected | CI `macos-latest` |
| Windows | ≥ 20 | same minor | 🔶 planned | CI `windows-latest` (Phase 5) |
| Linux | ≥ 20 | same minor | 🔶 later | non-goal for first release |

## Failure classes → recovery

| Check | Failure | Recovery message | Action |
|---|---|---|---|
| dsh executable | missing / not on PATH | "The Harness CLI 'dsh' is missing…" | install `@deepseek-ai/dsh` (dev) or repair bundled runtime (release) |
| node version | below floor | "Node.js 20+ is required…" | upgrade Node (dev) / none needed (bundled) |
| dsh version | major.minor mismatch | "Harness version mismatch: app expects X, found Y" | run upgrade/rollback flow (Task 2.3) |
| data directory | missing/unwritable | "Data directory is not readable/writable: …" | check permissions; reinstall |
| loopback health | no HTTP answer | "The Harness server at … is not responding" | retry; check port conflicts; view logs |
| protocol caps | (informational) | — | future capability negotiation (protocol v1 assumes `stream`) |

## Update procedure

Any dsh update must re-run the full matrix before release (Task 5.1 smoke
suite gates this). See `docs/upgrade-policy.md`.
