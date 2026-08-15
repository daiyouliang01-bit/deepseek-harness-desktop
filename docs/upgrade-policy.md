# Upgrade & Rollback Policy — DeepSeek Harness Desktop

> Task 2.3 deliverable. Governs how the app pins, upgrades, and rolls back the
> Harness runtime.

## Principles

1. **Pin, don't float.** The runtime version is recorded in the manifest
   (`runtime-manifest.json` under userData `config/`); the app never follows
   upstream releases automatically.
2. **Keep the previous known-good version.** One-step rollback is always
   available; history is capped at 3 retained versions.
3. **Upgrades require explicit user approval.** No silent runtime changes.
4. **Backup before migration, hash-verified.** User config is backed up with a
   SHA-256 checksum; restore refuses tampered backups.
5. **Failed upgrades auto-rollback.** If the compatibility checks (Task 2.2)
   or the smoke suite (Task 5.1) fail on the new version, the app restores the
   previous version and restores the user config from backup.

## Upgrade flow

```
user approves upgrade
  → backupFile(config)               # hash recorded
  → install new runtime dir          # runtimes/<version>/
  → recordUpgrade(manifest)          # previous := current, current := new
  → compatibility checks (T2.2)
  → smoke suite (T5.1)
       ├─ pass → done
       └─ fail → rollback(manifest)  # current := previous
               → restoreBackup(config)
               → removeRuntimeDir(broken)
               → recovery message in UI
```

## Storage layout

| Path (under userData) | Purpose |
|---|---|
| `config/runtime-manifest.json` | current / previous / history |
| `runtimes/<version>/` | installed runtime per version |
| `backups/backup-<stamp>` | hash-verified config backups |
| `logs/` | runtime logs (see data-locations.md) |

## Verification (what must pass before claiming rollback works)

- [x] Failed-upgrade simulation: upgrade to broken version → compatibility
      fails → rollback to previous → user data intact (unit test
      `upgrade-policy.test.ts`).
- [x] Tampered backup refused.
- [x] History capped; runtimes listable/removable.
- [ ] Real install test on macOS/Windows (Gate 2 / Phase 5).
