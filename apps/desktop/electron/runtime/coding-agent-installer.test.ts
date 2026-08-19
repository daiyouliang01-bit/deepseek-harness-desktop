import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  codingAgentSourceDir,
  codingAgentTargetDir,
  ensureCodingAgentLinked,
  ensureCodingAgentSkillsLinked,
} from './coding-agent-installer'

describe('coding-agent-installer', () => {
  let home: string
  let appRoot: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'cag-home-'))
    appRoot = mkdtempSync(join(tmpdir(), 'cag-app-'))
    mkdirSync(codingAgentSourceDir(appRoot), { recursive: true })
    writeFileSync(join(codingAgentSourceDir(appRoot), 'package.json'), '{}')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(appRoot, { recursive: true, force: true })
  })

  it('creates the symlink into the web profile node_modules', () => {
    const linked = ensureCodingAgentLinked(home, appRoot)
    const expected = join(codingAgentTargetDir(home), 'coding-agent-host')
    expect(linked).toBe(expected)
    expect(existsSync(expected)).toBe(true)
  })

  it('is idempotent (second call returns the same link)', () => {
    const a = ensureCodingAgentLinked(home, appRoot)
    const b = ensureCodingAgentLinked(home, appRoot)
    expect(a).toBe(b)
  })

  it('refreshes a stale symlink pointing at a moved source', () => {
    const other = mkdtempSync(join(tmpdir(), 'cag-other-'))
    const targetDir = codingAgentTargetDir(home)
    mkdirSync(targetDir, { recursive: true })
    symlinkSync(other, join(targetDir, 'coding-agent-host'), 'dir')

    const linked = ensureCodingAgentLinked(home, appRoot)
    expect(linked).toBe(join(targetDir, 'coding-agent-host'))
    expect(readlinkSync(join(targetDir, 'coding-agent-host'))).toBe(codingAgentSourceDir(appRoot))
    rmSync(other, { recursive: true, force: true })
  })

  it('returns null when the plugin source is missing (never throws)', () => {
    rmSync(appRoot, { recursive: true, force: true })
    expect(ensureCodingAgentLinked(home, appRoot)).toBeNull()
  })

  it('falls back to resourcesPath/plugins when appRoot has no plugin', () => {
    const resources = mkdtempSync(join(tmpdir(), 'cag-res-'))
    const plugin = join(resources, 'plugins', 'dsh-coding-agent')
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, 'package.json'), '{}')
    mkdirSync(join(resources, 'skills', 'project-onboarding'), { recursive: true })
    writeFileSync(join(resources, 'skills', 'project-onboarding', 'SKILL.md'), '---\nname: project-onboarding\n---\n')
    const emptyRoot = mkdtempSync(join(tmpdir(), 'cag-empty-'))
    const linked = ensureCodingAgentLinked(home, emptyRoot, resources)
    expect(linked).toBe(join(codingAgentTargetDir(home), 'coding-agent-host'))
    expect(readlinkSync(linked!)).toBe(plugin)
    expect(existsSync(join(home, 'skills', 'project-onboarding', 'SKILL.md'))).toBe(true)
    rmSync(resources, { recursive: true, force: true })
    rmSync(emptyRoot, { recursive: true, force: true })
  })

  it('symlinks bundled skills into the user DSH skills root', () => {
    mkdirSync(join(appRoot, 'skills', 'project-onboarding'), { recursive: true })
    writeFileSync(join(appRoot, 'skills', 'project-onboarding', 'SKILL.md'), '---\nname: project-onboarding\n---\n')
    const linked = ensureCodingAgentSkillsLinked(home, appRoot)
    expect(linked).toContain(join(home, 'skills', 'project-onboarding'))
    expect(existsSync(join(home, 'skills', 'project-onboarding', 'SKILL.md'))).toBe(true)
  })
})
