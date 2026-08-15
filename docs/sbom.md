# SBOM & License Audit — DeepSeek Harness Desktop

> Task 5.4 deliverable. Supply-chain compliance for the desktop app.

## SBOM

- Generated from the pnpm lockfile (`pnpm-lock.yaml`) by
  `apps/desktop/scripts/license-audit.ts` (pure parser + license annotator).
- Output: dependency inventory (name, version, license, permissive flag).
- Regenerate on every release; attach to the release notes.

## License policy

- **Permissive only** for distribution: MIT, Apache-2.0, BSD-2/3-Clause, ISC,
  0BSD, MPL-2.0.
- Anything else (or UNKNOWN) is flagged by `audit()` and must be triaged
  before release.
- Electron itself is MIT; the bundled Chromium runtime is covered by
  Electron's distribution terms.

## CI gates (T5.4)

| Gate | Mechanism |
|---|---|
| Dependency vulnerabilities | `pnpm audit` in CI (lockfile pinned) |
| License audit | `license-audit` unit tests + release check |
| Supply-chain policy | pnpm lockfile policy check (already active) |
| Visual regression | Playwright screenshot compare (GUI session, T5.4) |
| Accessibility | axe checks in the E2E suite (GUI session) |
| Smoke suite | `pnpm test:smoke` — real dsh against pinned version |

## Support bundle

`scripts/support-bundle` (in `electron/support/support-bundle.ts`) exports
logs + versions + config as a zip/dir, **excluding `secrets.json`**; a
`scanForSecrets` safety check scans collected files for key patterns before
sharing. Never includes API keys by construction.

## Known limitations

- Lockfile parsing is a simplified parser (pnpm v9 format); a full SBOM tool
  (e.g. `@cyclonedx/cyclonedx-npm`) can be added later for release-grade SBOMs.
- Visual regression + axe require a GUI session (CI macOS runners provide it).
