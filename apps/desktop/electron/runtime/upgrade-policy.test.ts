import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupFile, pruneBackups, restoreBackup, verifyBackup } from './migrations'
import {
  createManifest,
  listInstalledRuntimes,
  loadManifest,
  recordUpgrade,
  removeRuntimeDir,
  rollback,
  saveManifest,
  type RuntimeManifest
} from './runtime-manifest'

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

describe('runtime manifest', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-manifest-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates and persists a manifest', () => {
    const m = createManifest('0.1.0-rc.6', '0.1.0')
    saveManifest(dir, m)
    const loaded = loadManifest(dir)
    expect(loaded?.current).toBe('0.1.0-rc.6')
    expect(loaded?.history).toEqual(['0.1.0-rc.6'])
  })

  it('records upgrades and keeps previous + capped history', () => {
    let m = createManifest('0.1.0-rc.6', '0.1.0')
    m = recordUpgrade(m, '0.2.0')
    m = recordUpgrade(m, '0.3.0')
    m = recordUpgrade(m, '0.4.0')
    expect(m.current).toBe('0.4.0')
    expect(m.previous).toBe('0.3.0')
    expect(m.history.length).toBeLessThanOrEqual(3)
    expect(m.history[0]).toBe('0.3.0')
  })

  it('rolls back to the previous known-good version', () => {
    let m = createManifest('0.1.0-rc.6', '0.1.0')
    m = recordUpgrade(m, '0.2.0-broken')
    const rolled = rollback(m)
    expect(rolled).not.toBeNull()
    expect(rolled?.current).toBe('0.1.0-rc.6')
    // a second rollback has nothing to go back to
    expect(rollback(rolled as RuntimeManifest)).toBeNull()
  })

  it('lists installed runtimes and removes one', () => {
    write(join(dir, '0.1.0-rc.6', 'placeholder'), 'x')
    write(join(dir, '0.2.0', 'placeholder'), 'x')
    const installed = listInstalledRuntimes(dir)
    expect(installed).toEqual(expect.arrayContaining(['0.1.0-rc.6', '0.2.0']))
    removeRuntimeDir(dir, '0.2.0')
    expect(listInstalledRuntimes(dir)).not.toContain('0.2.0')
  })
})

describe('migrations (backup/restore)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-migrate-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('backs up with hash and restores intact', () => {
    const config = join(dir, 'config', 'settings.yaml')
    write(config, 'key: value\n')

    const backupsDir = join(dir, 'backups')
    const backup = backupFile(config, backupsDir)
    expect(verifyBackup(backup)).toBe(true)

    // corrupt the live file, then restore
    write(config, 'corrupted!!!')
    restoreBackup(backup, config)
    expect(readFileSync(config, 'utf8')).toBe('key: value\n')
  })

  it('refuses to restore a tampered backup', () => {
    const config = join(dir, 'config', 'settings.yaml')
    write(config, 'original')
    const backup = backupFile(config, join(dir, 'backups'))

    writeFileSync(backup.path, 'tampered')
    expect(verifyBackup(backup)).toBe(false)
    expect(() => restoreBackup(backup, config)).toThrow(/hash verification/)
  })

  it('prunes old backups keeping the newest N', () => {
    const config = join(dir, 'config', 'settings.yaml')
    write(config, 'x')
    const backupsDir = join(dir, 'backups')
    for (let i = 0; i < 5; i++) {
      backupFile(config, backupsDir)
    }
    pruneBackups(backupsDir, 2)
    const remaining = require('node:fs').readdirSync(backupsDir) as string[]
    expect(remaining.length).toBe(2)
  })

  it('simulates a failed upgrade: backup → upgrade → fail → rollback, user data intact', () => {
    // user data (settings + a session file)
    const userData = join(dir, 'userdata')
    const settings = join(userData, 'settings.yaml')
    const sessions = join(userData, 'sessions.jsonl')
    write(settings, 'model: deepseek-v4-flash\n')
    write(sessions, '{"id":1}\n')

    // manifest: 0.1.0-rc.6 current, upgrade to 0.2.0-broken
    const manifestDir = join(userData, 'config')
    let manifest = createManifest('0.1.0-rc.6', '0.1.0')
    saveManifest(manifestDir, manifest)

    // user approves upgrade → backup first (hash-verified)
    const backupsDir = join(userData, 'backups')
    const backup = backupFile(settings, backupsDir)
    manifest = recordUpgrade(manifest, '0.2.0-broken')
    saveManifest(manifestDir, manifest)

    // ... upgrade fails (simulate: settings got mangled by the broken runtime)
    write(settings, 'garbage from broken runtime')

    // rollback: previous known-good version
    const rolled = rollback(loadManifest(manifestDir) as RuntimeManifest)
    expect(rolled?.current).toBe('0.1.0-rc.6')
    saveManifest(manifestDir, rolled as RuntimeManifest)

    // restore user data from the verified backup
    restoreBackup(backup, settings)
    expect(readFileSync(settings, 'utf8')).toBe('model: deepseek-v4-flash\n')
    // sessions untouched
    expect(readFileSync(sessions, 'utf8')).toBe('{"id":1}\n')
    // manifest now points back at the known-good version
    expect(loadManifest(manifestDir)?.current).toBe('0.1.0-rc.6')
    expect(existsSync(settings)).toBe(true)
  })
})
