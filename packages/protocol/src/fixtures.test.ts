import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeEvent } from './events'

/**
 * Fixture corpus regression (v2.1 ⭐): every recorded event line must decode
 * without rejection. Phase 3 replays these through the event reducer.
 */
const FIXTURES_DIR = join(__dirname, '../../../tests/fixtures/events')

describe('event fixture corpus', () => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'))

  it('has at least the six planned scenarios', () => {
    const names = files.map((f) => f.replace('.json', ''))
    for (const expected of ['normal-answer', 'tool-loop', 'parallel-tools', 'cancellation', 'rate-limit-error', 'reconnect']) {
      expect(names).toContain(expected)
    }
  })

  for (const file of files) {
    it(`replays ${file} cleanly`, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), 'utf8')
      const lines = JSON.parse(raw) as unknown[]
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) {
        const res = decodeEvent(JSON.stringify(line))
        expect(res.ok, `line failed in ${file}: ${JSON.stringify(line)}`).toBe(true)
      }
    })
  }
})
