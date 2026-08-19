import { describe, expect, it } from 'vitest'
import { appendMemory, readMemory } from './memory'

describe('readMemory', () => {
  it('trims and caps memory at 8192 bytes', () => {
    expect(readMemory('  hello  ')).toBe('hello')
    const huge = 'n'.repeat(10_000)
    expect(Buffer.byteLength(readMemory(huge), 'utf8')).toBeLessThanOrEqual(8192)
  })
})

describe('appendMemory', () => {
  it('appends a short durable fact', () => {
    const result = appendMemory('use pnpm', 'tests live in packages/*')
    expect(result).toEqual({ ok: true, next: 'use pnpm\ntests live in packages/*' })
  })

  it('rejects empty, secret, and over-cap entries', () => {
    expect(appendMemory('a', '   ')).toEqual({ ok: false, reason: 'empty' })
    expect(appendMemory('a', 'api_key=sk-live')).toEqual({ ok: false, reason: 'secret' })
    expect(appendMemory('a', 'the bearer token is xyz')).toEqual({ ok: false, reason: 'secret' })
    expect(appendMemory('n'.repeat(8180), 'another long fact that will not fit')).toEqual({
      ok: false,
      reason: 'cap',
    })
  })

  it('does not false-positive on words containing secret fragments', () => {
    expect(appendMemory('a', 'gentoken handles keyboard tokens')).toEqual({
      ok: true,
      next: 'a\ngentoken handles keyboard tokens',
    })
  })
})
