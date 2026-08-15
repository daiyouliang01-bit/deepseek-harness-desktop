# Rollback Runbook — DeepSeek Harness Desktop

> Task 5.2 deliverable (⭐ v2.1). Manual recovery when automatic rollback
> (Task 2.3) cannot run — e.g. the app itself won't launch.

## When to use

1. App fails to launch after a Harness runtime upgrade.
2. Automatic rollback didn't trigger (crash before the manifest update).
3. User data appears missing after a failed upgrade.

## Steps (macOS shown; Windows paths analogous)

### 1. Locate the data directory

```
~/Library/Application Support/@dshd/desktop/
├── config/runtime-manifest.json   # current / previous / history
├── runtimes/<version>/            # installed runtimes
├── backups/backup-<stamp>         # hash-verified config backups
└── logs/
```

### 2. Identify the known-good version

```sh
cat config/runtime-manifest.json
# previous: "0.1.0-rc.6"  ← roll back to this
```

### 3. Switch the manifest back

Edit `config/runtime-manifest.json`: set `current` to the `previous` value and
clear `previous`. (The app also does this automatically via `rollback()`.)

### 4. Restore user config from the verified backup

```sh
ls -t backups/ | head -1        # newest backup
# verify checksum matches the .sha256 recorded in the backup filename
cp backups/backup-<stamp> config/settings.yaml   # or the original path
```

Backups are SHA-256 verified by the app; a tampered backup is refused.

### 5. Remove the broken runtime (optional, frees space)

```sh
rm -rf runtimes/<broken-version>
```

### 6. Relaunch

The app boots the known-good runtime. If it still fails, collect the support
bundle (`logs/`, manifest, `dsh --version`) and report.

## Data safety rules

- Never delete `backups/` before the app runs cleanly again.
- Never hand-edit runtime files under `runtimes/<version>/`.
- User sessions live under Harness's own `~/.dsh/sessions` — untouched by
  rollback.
