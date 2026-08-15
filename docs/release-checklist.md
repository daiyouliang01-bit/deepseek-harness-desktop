# Release Checklist — DeepSeek Harness Desktop

> Task 5.2 deliverable. Run top-to-bottom before every release (dev and
> production). Signing/notarization/auto-update apply to production releases
> (Phase 5 gates).

## Prerequisites

- [ ] Pinned runtime version recorded in the runtime manifest (Task 2.3)
- [ ] Compatibility matrix re-run for this dsh version (Task 2.2)
- [ ] Smoke suite green: `pnpm test:smoke` (Task 5.1)
- [ ] Full test suite green: `pnpm test` + `pnpm typecheck`
- [ ] E2E shell smoke green in a GUI session: `pnpm test:e2e`
- [ ] CHANGELOG entry drafted

## Build

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm --filter @dshd/desktop package` (dev) or release pipeline
- [ ] Artifacts produced: macOS `.dmg`/`.zip`, Windows `.exe`/`.zip`
- [ ] Installer tested on a machine **without global Node.js** (release builds
      bundle the runtime per ADR-002; dev builds require dsh on PATH)

## Signing & distribution (production)

- [ ] macOS: Developer ID signing + notarization (CI secrets configured)
- [ ] Windows: code-signing cert (EV recommended); SmartScreen notes documented
- [ ] Auto-update feed configured (GitHub Releases, ADR-003) — client in T5.3
- [ ] Runtime version mapping documented (app version ↔ dsh version)

## Verification

- [ ] Fresh install → runtime boots → official UI opens (or custom shell)
- [ ] Upgrade from previous release → rollback works on failure (Gate 2)
- [ ] Uninstall → reinstall preserves user data
- [ ] Logs + diagnostics bundle (T5.4) collect correctly, no API keys inside
- [ ] SBOM + license audit passed (T5.4)

## Post-release

- [ ] Tag + GitHub Release with checksums
- [ ] Troubleshooting + rollback runbook updated
- [ ] Update `docs/progress.md`
