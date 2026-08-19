import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SKILLS_ROOT = join(__dirname, '../../skills')

function parseFrontmatter(text: string): { name?: string; description?: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const fields: { name?: string; description?: string } = {}
  for (const line of match[1].split('\n')) {
    const cut = line.indexOf(':')
    if (cut < 0) continue
    const key = line.slice(0, cut).trim()
    const value = line.slice(cut + 1).trim()
    if (key === 'name' || key === 'description') fields[key] = value
  }
  return fields
}

describe('coding-agent official skills', () => {
  it('ships three kebab-case SKILL.md bundles', () => {
    expect(existsSync(SKILLS_ROOT)).toBe(true)
    const names = readdirSync(SKILLS_ROOT).sort()
    expect(names).toEqual(['project-onboarding', 'small-safe-edits', 'verify-before-complete'])
    for (const name of names) {
      const text = readFileSync(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8')
      const meta = parseFrontmatter(text)
      expect(meta.name).toBe(name)
      expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(meta.description?.length).toBeGreaterThan(10)
      expect(text).not.toContain('import ')
    }
  })
})
