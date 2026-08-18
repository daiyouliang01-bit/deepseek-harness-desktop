import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensurePhoneSettingsLinked,
  phoneSettingsSourceDir,
  phoneSettingsTargetDir,
} from './phone-settings-installer'

describe('phone-settings-installer', () => {
  let home: string
  let appRoot: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pset-home-'))
    appRoot = mkdtempSync(join(tmpdir(), 'pset-app-'))
    mkdirSync(phoneSettingsSourceDir(appRoot), { recursive: true })
    writeFileSync(join(phoneSettingsSourceDir(appRoot), 'package.json'), '{}')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(appRoot, { recursive: true, force: true })
  })

  it('creates the symlink into the web profile node_modules', () => {
    const linked = ensurePhoneSettingsLinked(home, appRoot)
    const expected = join(phoneSettingsTargetDir(home), 'phone-settings')
    expect(linked).toBe(expected)
    expect(existsSync(expected)).toBe(true)
  })

  it('is idempotent (second call returns the same link)', () => {
    const a = ensurePhoneSettingsLinked(home, appRoot)
    const b = ensurePhoneSettingsLinked(home, appRoot)
    expect(a).toBe(b)
  })

  it('refreshes a stale symlink pointing at a moved source', () => {
    const other = mkdtempSync(join(tmpdir(), 'pset-other-'))
    const targetDir = phoneSettingsTargetDir(home)
    mkdirSync(targetDir, { recursive: true })
    symlinkSync(other, join(targetDir, 'phone-settings'), 'dir')

    const linked = ensurePhoneSettingsLinked(home, appRoot)
    expect(linked).toBe(join(targetDir, 'phone-settings'))
    expect(readlinkSync(join(targetDir, 'phone-settings'))).toBe(phoneSettingsSourceDir(appRoot))
    rmSync(other, { recursive: true, force: true })
  })

  it('returns null when the plugin source is missing (never throws)', () => {
    rmSync(appRoot, { recursive: true, force: true })
    expect(ensurePhoneSettingsLinked(home, appRoot)).toBeNull()
  })
})
