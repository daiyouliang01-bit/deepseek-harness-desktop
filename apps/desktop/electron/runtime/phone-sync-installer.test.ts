import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensurePhoneSyncLinked, phoneSyncSourceDir, profileTargetDir } from './phone-sync-installer'

describe('phone-sync-installer', () => {
  let home: string
  let appRoot: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'psync-home-'))
    appRoot = mkdtempSync(join(tmpdir(), 'psync-app-'))
    // fake plugin source
    mkdirSync(phoneSyncSourceDir(appRoot), { recursive: true })
    writeFileSync(join(phoneSyncSourceDir(appRoot), 'package.json'), '{}')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(appRoot, { recursive: true, force: true })
  })

  it('creates the symlink into the web profile node_modules', () => {
    const linked = ensurePhoneSyncLinked(home, appRoot)
    const expected = join(profileTargetDir(home), 'phone-sync')
    expect(linked).toBe(expected)
    expect(existsSync(expected)).toBe(true)
  })

  it('is idempotent (second call returns the same link)', () => {
    const a = ensurePhoneSyncLinked(home, appRoot)
    const b = ensurePhoneSyncLinked(home, appRoot)
    expect(a).toBe(b)
  })

  it('refreshes a stale symlink pointing at a moved source', () => {
    const other = mkdtempSync(join(tmpdir(), 'psync-other-'))
    const targetDir = profileTargetDir(home)
    mkdirSync(targetDir, { recursive: true })
    symlinkSync(other, join(targetDir, 'phone-sync'), 'dir')

    const linked = ensurePhoneSyncLinked(home, appRoot)
    expect(linked).toBe(join(targetDir, 'phone-sync'))
    // now points at the app source, not the stale dir
    const { readlinkSync } = require('node:fs') as typeof import('node:fs')
    expect(readlinkSync(join(targetDir, 'phone-sync'))).toBe(phoneSyncSourceDir(appRoot))
    rmSync(other, { recursive: true, force: true })
  })

  it('returns null when the plugin source is missing (never throws)', () => {
    rmSync(appRoot, { recursive: true, force: true })
    expect(ensurePhoneSyncLinked(home, appRoot)).toBeNull()
  })
})
