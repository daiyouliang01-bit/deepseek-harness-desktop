# Implementation Tracking — DeepSeek Harness Desktop

Live status of the v2.1 plan (`deepseek-harness-desktop-plan.optimized.md`).
Updated as tasks complete.

## Phase 0 — ✅ done

| Task | Status | Notes |
|---|---|---|
| T0.1 upstream contract | ✅ | docs/upstream-contract.md (dsh 0.1.0-rc.6 verified live) |
| T0.2 product scope | ✅ | docs/product-scope.md |

## Phase 1 — ✅ done (Gate 1 pending machine verification)

| Task | Status | Notes |
|---|---|---|
| T1.1 secure shell | ✅ | electron-vite + React; single-instance; CSP; E2E smoke (skips headless) |
| T1.2 HarnessProcess | ✅ | 8 unit + 2 real-dsh integration tests; tree kill; dual-channel ready |
| T1.3 load official UI | ✅ | auto-start, validated loopback load, recovery screen, guard tests |
| T1.4 dev packaging | ✅ (config) | electron-builder.yml + CI; local package blocked by sandbox network |
| T1.5 tray/shortcut/notifications | ✅ | tray + Cmd+Shift+Space summon + runtime notifications + hide-to-tray + View menu shell↔official toggle; 9 tests; docs/desktop-behavior.md |

**Gate 1**: security baseline ✅ · lifecycle ✅ · CI scripts ✅ · "runs without
global Node" and packaged-app smoke **must be verified on a real machine / CI**
(sandbox has no GUI + GitHub CDN blocked). E2E spec skips gracefully headless.

## Phase 2 — ✅ done (Gate 2 pending machine verification)

| Task | Status | Notes |
|---|---|---|
| T2.1 desktop protocol | ✅ | @dshd/protocol: events/commands/version/errors; unknown-event tolerance, malformed rejection, version negotiation; 20 tests + 6-scenario fixture corpus |
| T2.2 compatibility | ✅ | dsh/Node/version/data-dir/health checks with recovery messages; 9 tests; docs/compatibility-matrix.md |
| T2.3 upgrade/rollback | ✅ | runtime manifest (pin/previous/history), hash-verified backups, failed-upgrade simulation; 8 tests; docs/upgrade-policy.md |

**Gate 2**: protocol tests ✅ · compatibility matrix ✅ (macOS tested) ·
failed-upgrade rollback demo ✅ (unit-simulated) · real-device verification
pending (CI / user machine).

## Phase 3 — ✅ done

| Task | Status | Notes |
|---|---|---|
| T3.1 app shell | ✅ | tokens + sidebar + settings + shell view w/ diagnostic toggle |
| T3.2 event rendering | ✅ | pure reducer + store + ChatView; 11 fixture-replay tests |
| T3.3 persistence | ✅ | @dshd/session-store (node:sqlite, WAL, FTS5, import/export); 9 tests |
| T3.4 interactions | ✅ | branch.ts regenerate/edit/branch + custom instructions; 10 tests |
| T3.5 attachments/onboarding | ✅ | attachment sandbox (6 tests) + safeStorage KeyVault (6 tests) + onboarding wizard |

**Gate 3** (unit level): MVP parity UI in place · persistence survives reopen ✅ ·
import/export round-trip ✅ · conversation interactions ✅ · key flow ✅.
Visual parity vs official UI + real-device verification pending (GUI session).

## Phase 4 — ✅ done

| Task | Status | Notes |
|---|---|---|
| T4.1 permission levels | ✅ | @dshd/permissions: policy/approval/audit/budget; 15 tests + matrix doc |
| T4.2 projects/files/terminal/artifacts | ✅ | tree/diff/artifact-whitelist/jobs models; 11 tests |

**Gate 4** (unit level): permission matrix ✅ · budget block ✅ · e2e剧本
(select project → read → propose → approve → diff → reject → recover) needs
real-device verification in the GUI session.

## Phase 5 — ✅ done

| Task | Status | Notes |
|---|---|---|
| T5.1 smoke suite | ✅ | tests/compatibility: real dsh startup/HTTP/restart/persistence; 5 tests |
| T5.2 release docs | ✅ | release-checklist / troubleshooting / rollback-runbook |
| T5.3 auto-update client | ✅ | UpdateManager (8 tests) + IPC + settings UI (electron-updater) |
| T5.4 compliance | ✅ | license audit + support bundle + docs/sbom.md + CI audit/smoke gates; 10 tests |

## ✅ All phases implemented (unit-level)

132 tests green: protocol 20 · permissions 15 · session-store 9 · desktop 88
(harness-process 10, compat 9, upgrade 8, guard 4, reducer 11, branch 10,
T4.2 features 11, sandbox 6, vault 6, updater 8, support/audit 10, misc).

## Remaining (requires GUI/real device — outside this agent shell)

- E2E shell smoke (runs on your desktop: `pnpm build && pnpm test:e2e`)
- electron-builder packaging (network: run `pnpm --filter @dshd/desktop package`)
- Visual parity check of custom shell vs official UI (Gate 3)
- macOS/Windows signed installers + auto-update end-to-end (Gate 5)

## Known environment limits (this agent shell)

- No GUI/WindowServer access → Electron windows can't open; E2E skips.
- GitHub raw/CDN blocked → Electron binary used npmmirror; electron-builder
  binary download blocked → packaging verified via CI/user machine.
- `dsh web` runs headless (plain HTTP) → real-runtime integration tests work.
