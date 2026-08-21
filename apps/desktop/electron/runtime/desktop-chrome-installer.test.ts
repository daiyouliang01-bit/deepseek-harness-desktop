import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  desktopChromeSourceDir,
  desktopChromeTargetDir,
  ensureDesktopChromeLinked,
} from './desktop-chrome-installer'

describe('desktop-chrome-installer', () => {
  let home: string
  let appRoot: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dchrome-home-'))
    appRoot = mkdtempSync(join(tmpdir(), 'dchrome-app-'))
    mkdirSync(desktopChromeSourceDir(appRoot), { recursive: true })
    writeFileSync(join(desktopChromeSourceDir(appRoot), 'package.json'), '{}')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(appRoot, { recursive: true, force: true })
  })

  it('links into the desktop profile node_modules', () => {
    const linked = ensureDesktopChromeLinked(home, appRoot)
    const expected = join(desktopChromeTargetDir(home), 'desktop-chrome')
    expect(linked).toBe(expected)
    expect(existsSync(expected)).toBe(true)
    expect(readlinkSync(expected)).toBe(desktopChromeSourceDir(appRoot))
  })

  it('is idempotent', () => {
    expect(ensureDesktopChromeLinked(home, appRoot)).toBe(ensureDesktopChromeLinked(home, appRoot))
  })

  it('refreshes a stale symlink', () => {
    const other = mkdtempSync(join(tmpdir(), 'dchrome-other-'))
    const targetDir = desktopChromeTargetDir(home)
    mkdirSync(targetDir, { recursive: true })
    symlinkSync(other, join(targetDir, 'desktop-chrome'), 'dir')
    const linked = ensureDesktopChromeLinked(home, appRoot)
    expect(linked).toBe(join(targetDir, 'desktop-chrome'))
    expect(readlinkSync(join(targetDir, 'desktop-chrome'))).toBe(desktopChromeSourceDir(appRoot))
    rmSync(other, { recursive: true, force: true })
  })

  it('returns null when source is missing', () => {
    rmSync(appRoot, { recursive: true, force: true })
    expect(ensureDesktopChromeLinked(home, appRoot)).toBeNull()
  })
})
