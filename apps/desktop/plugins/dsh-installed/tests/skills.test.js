import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter, readUserSkills } from '../lib/skills.js'

describe('parseFrontmatter', () => {
  it('reads name and description', () => {
    const meta = parseFrontmatter('---\nname: demo\ndescription: "A demo skill"\n---\n# body\n')
    assert.equal(meta.name, 'demo')
    assert.equal(meta.description, 'A demo skill')
  })
  it('returns empty object without a fence', () => {
    assert.deepEqual(parseFrontmatter('# just markdown\n'), {})
  })
})

describe('readUserSkills', () => {
  it('scans user roots and skips project roots without cwd', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-skill-home-'))
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-skill-dsh-'))
    const project = mkdtempSync(join(tmpdir(), 'dsh-skill-proj-'))
    mkdirSync(join(home, '.agents', 'skills', 'alpha'), { recursive: true })
    writeFileSync(join(home, '.agents', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: User skill\n---\n')
    mkdirSync(join(dshHome, 'skills', 'beta'), { recursive: true })
    writeFileSync(join(dshHome, 'skills', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: DSH user skill\n---\n')
    mkdirSync(join(project, '.agents', 'skills', 'gamma'), { recursive: true })
    writeFileSync(join(project, '.agents', 'skills', 'gamma', 'SKILL.md'), '---\nname: gamma\ndescription: Project only\n---\n')

    const withoutCwd = readUserSkills({ homedir: home, dshHome })
    assert.deepEqual(withoutCwd.map((item) => item.name).sort(), ['alpha', 'beta'])
    assert.equal(withoutCwd.find((item) => item.name === 'alpha').root, 'user-agents')

    const withCwd = readUserSkills({ homedir: home, dshHome, cwd: project })
    assert.deepEqual(withCwd.map((item) => item.name).sort(), ['alpha', 'beta', 'gamma'])
  })

  it('ignores folders without SKILL.md', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-skill-empty-'))
    mkdirSync(join(home, '.agents', 'skills', 'nope'), { recursive: true })
    writeFileSync(join(home, '.agents', 'skills', 'nope', 'README.md'), 'no')
    assert.deepEqual(readUserSkills({ homedir: home, dshHome: home }), [])
  })
})
