import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  communityLinksSourceDir,
  communityLinksTargetDir,
  ensureCommunityLinksLinked,
} from './community-links-installer'

describe('community-links-installer', () => {
  let home: string
  let appRoot: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'clinks-home-'))
    appRoot = mkdtempSync(join(tmpdir(), 'clinks-app-'))
    mkdirSync(communityLinksSourceDir(appRoot), { recursive: true })
    writeFileSync(join(communityLinksSourceDir(appRoot), 'package.json'), '{}')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(appRoot, { recursive: true, force: true })
  })

  it('creates the symlink into the web profile node_modules', () => {
    const linked = ensureCommunityLinksLinked(home, appRoot)
    const expected = join(communityLinksTargetDir(home), 'community-links')
    expect(linked).toBe(expected)
    expect(existsSync(expected)).toBe(true)
  })

  it('is idempotent (second call returns the same link)', () => {
    const a = ensureCommunityLinksLinked(home, appRoot)
    const b = ensureCommunityLinksLinked(home, appRoot)
    expect(a).toBe(b)
  })

  it('refreshes a stale symlink pointing at a moved source', () => {
    const other = mkdtempSync(join(tmpdir(), 'clinks-other-'))
    const targetDir = communityLinksTargetDir(home)
    mkdirSync(targetDir, { recursive: true })
    symlinkSync(other, join(targetDir, 'community-links'), 'dir')

    const linked = ensureCommunityLinksLinked(home, appRoot)
    expect(linked).toBe(join(targetDir, 'community-links'))
    expect(readlinkSync(join(targetDir, 'community-links'))).toBe(communityLinksSourceDir(appRoot))
    rmSync(other, { recursive: true, force: true })
  })

  it('returns null when the plugin source is missing (never throws)', () => {
    rmSync(appRoot, { recursive: true, force: true })
    expect(ensureCommunityLinksLinked(home, appRoot)).toBeNull()
  })
})
