# Product Scope — DeepSeek Harness Desktop

> Task 0.2 deliverable. Defines the MVP, its acceptance criteria, and what is
> explicitly deferred. Version: v2.1 of the implementation plan
> (`deepseek-harness-desktop-plan.optimized.md`).

## Vision (one line)

A cross-platform desktop client around the official DeepSeek Harness that first
reliably wraps the official Web UI and later becomes a local-first
ChatGPT/Claude-style Agent workspace.

## MVP (first release)

| # | MVP item | Acceptance criterion |
|---|---|---|
| 1 | Launch local Harness runtime | App spawns the pinned `dsh web` (Node runtime bundled), binds `127.0.0.1` on a free port, and reports ready. |
| 2 | Show official Web UI | Window loads only the validated loopback URL; renders correctly at desktop window sizes. |
| 3 | Configure API key safely | Key entered in the app, stored via OS-protected storage (safeStorage), never in renderer/repo/files; a validation call confirms it works. |
| 4 | Stop / restart runtime | Tray/menu actions stop and restart the child process cleanly; full process tree is killed on exit. |
| 5 | Show startup failures | Recovery screen with retry, restart runtime, open logs, quit. |
| 6 | Quit cleanly | Closing quits on Windows/Linux, docks to tray on macOS (Task 1.5). |
| 7 | Package for one dev platform | Local installer/portable artifact runs on a machine without global Node.js. |
| 8 | Pass smoke tests | Startup, chat, streaming, tool call, cancellation, restart, data preservation pass the compatibility suite (Task 5.1). |
| 9 | Native desktop feel | System tray, global shortcut to summon, notifications (Task 1.5). |
| 10 | Secure baseline | `contextIsolation: true`, `nodeIntegration: false`, sandboxed preload, CSP, navigation guard; renderer has no Node/FS access. |

## Deferred (with later phase)

| Deferred item | Later phase |
|---|---|
| Custom chat UI replacing official Web UI | Phase 3 (after Gate 1 + Gate 2) |
| Message regenerate / edit / branch, custom instructions | Phase 3 (T3.4) |
| Attachments, onboarding wizard, key validation/rotation | Phase 3 (T3.5) |
| Local persistence (SQLite) + full-text search | Phase 3 (T3.3) |
| Permission model, cost guardrail, audit log | Phase 4 |
| Projects / files / terminal / artifacts | Phase 4 |
| Auto-update client | Phase 5 (T5.3) |
| SBOM / license audit / visual regression / a11y CI | Phase 5 (T5.4) |
| Compatibility smoke suite | Phase 5 (T5.1) |

## Explicitly out of scope (non-goals, first release)

- Reimplementing the Harness Agent Loop.
- Cloud account sync and billing (cost guardrail is a safety cap, not billing).
- Supporting every LLM provider.
- Mobile apps.
- A plugin marketplace.
- Automatic unreviewed shell execution.
- Linux release before macOS/Windows packaging is stable.
- Any telemetry/cloud sync except crash reporting (off by default).

## Release gates (summary)

- Gate 0: contract reviewed + scope approved.
- Gate 1: secure shell + runtime lifecycle + dev packaging + CI green.
- Gate 2: protocol + compatibility matrix + rollback demo.
- Gate 3: custom UI parity + persistence + conversation interactions.
- Gate 4: permission/approval e2e + budget guardrail demo.
- Gate 5: signed installers + auto-update + compliance + docs.

See the implementation plan for the full gate definitions.
