import { describe, expect, it } from 'vitest'
import { HookRegistry } from './hooks'

describe('HookRegistry', () => {
  it('runs registered listeners in order', () => {
    const hooks = new HookRegistry()
    const seen: string[] = []
    hooks.on('afterEdit', (payload) => {
      seen.push(`a:${String(payload)}`)
    })
    hooks.on('afterEdit', (payload) => {
      seen.push(`b:${String(payload)}`)
    })
    hooks.run('afterEdit', 'file.ts')
    expect(seen).toEqual(['a:file.ts', 'b:file.ts'])
  })

  it('swallows listener errors and still runs later listeners', () => {
    const hooks = new HookRegistry()
    const seen: string[] = []
    hooks.on('beforeTask', () => {
      throw new Error('boom')
    })
    hooks.on('beforeTask', () => {
      seen.push('ok')
    })
    expect(() => hooks.run('beforeTask', {})).not.toThrow()
    expect(seen).toEqual(['ok'])
    expect(hooks.errors).toHaveLength(1)
    expect(hooks.errors[0]?.name).toBe('beforeTask')
  })

  it('on() returns an unsubscribe function', () => {
    const hooks = new HookRegistry()
    let calls = 0
    const off = hooks.on('afterTool', () => {
      calls += 1
    })
    off()
    hooks.run('afterTool', {})
    expect(calls).toBe(0)
  })

  it('bounds the error log so a throwing hook cannot grow forever', () => {
    const hooks = new HookRegistry()
    for (let i = 0; i < hooks.MAX_ERRORS + 10; i += 1) {
      hooks.run('afterEdit', i)
    }
    expect(hooks.errors.length).toBeLessThanOrEqual(hooks.MAX_ERRORS)
  })
})
