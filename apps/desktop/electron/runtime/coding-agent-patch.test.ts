import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PATCH = join(__dirname, '../../resources/desktop-tools.patch.yml')

describe('desktop-tools.patch.yml coding-agent row', () => {
  const text = readFileSync(PATCH, 'utf8')

  it('inserts a new coding-agent host row', () => {
    expect(text).toMatch(/- insert:\n\s+- id: coding-agent\n\s+name: '@dshd\/coding-agent-host'/)
  })

  it('does not change the existing desktop-auto permission default', () => {
    expect(text).toContain('defaultPreset: desktop-auto')
  })

  it('does not disable phone-sync', () => {
    expect(text).toContain("- id: phone-sync")
    expect(text).toContain("name: '@dshd/phone-sync'")
  })

  it('inserts desktop-only chrome (not shared with :3080)', () => {
    expect(text).toContain("- id: desktop-chrome")
    expect(text).toContain("name: '@dshd/desktop-chrome'")
  })
})
