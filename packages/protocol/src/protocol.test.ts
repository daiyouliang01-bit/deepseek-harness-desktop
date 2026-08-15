import { describe, expect, it } from 'vitest'
import { decodeCommand, encodeCommand } from './commands'
import { decodeEvent, decodeEventObject } from './events'
import { classifyError, isRetryable } from './errors'
import { isCompatible, negotiate, parseVersion, PROTOCOL_VERSION } from './version'

describe('protocol version negotiation', () => {
  it('exposes a current version', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1)
  })

  it('parses version strings and numbers', () => {
    expect(parseVersion('1.2')).toEqual({ major: 1, minor: 2 })
    expect(parseVersion(2)).toEqual({ major: 2, minor: 0 })
    expect(parseVersion('1.2.3-rc')).toEqual({ major: 1, minor: 2 })
    expect(() => parseVersion('abc')).toThrow()
  })

  it('negotiates same-major as compatible', () => {
    expect(isCompatible(1, '1.5')).toBe(true)
    expect(negotiate(1, '1.5').ok).toBe(true)
  })

  it('rejects different majors', () => {
    expect(isCompatible(1, 2)).toBe(false)
    const res = negotiate(1, 2)
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/major mismatch/)
  })
})

describe('event decoding', () => {
  it('round-trips a message event', () => {
    const line = JSON.stringify({ type: 'message', id: 'm1', role: 'assistant', content: 'hi', ts: 123 })
    const res = decodeEvent(line)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.event).toMatchObject({ type: 'message', id: 'm1', role: 'assistant', content: 'hi', ts: 123 })
    }
  })

  it('decodes delta, reasoning, tool-call, tool-result, approval, error, completion', () => {
    const cases: Array<[string, string]> = [
      [JSON.stringify({ type: 'delta', id: 'd1', seq: 1, text: 'a' }), 'delta'],
      [JSON.stringify({ type: 'reasoning', id: 'r1', seq: 2, text: 'think' }), 'reasoning'],
      [JSON.stringify({ type: 'tool-call', id: 't1', callId: 'c1', name: 'bash', args: { cmd: 'ls' } }), 'tool-call'],
      [JSON.stringify({ type: 'tool-result', id: 't2', callId: 'c1', ok: true, output: 'x' }), 'tool-result'],
      [JSON.stringify({ type: 'approval-request', id: 'a1', permission: 'file:write' }), 'approval-request'],
      [JSON.stringify({ type: 'error', id: 'e1', code: 'timeout', message: 'boom', retryable: true }), 'error'],
      [JSON.stringify({ type: 'completion', id: 'x1', usage: { tokens: 12 } }), 'completion']
    ]
    for (const [line, type] of cases) {
      const res = decodeEvent(line)
      expect(res.ok, `${type} should decode`).toBe(true)
      if (res.ok) expect(res.event.type).toBe(type)
    }
  })

  it('tolerates unknown event types (future minor versions)', () => {
    const res = decodeEvent(JSON.stringify({ type: 'future-thing', id: 'f1', whatever: 1 }))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.event.type).toBe('unknown')
      expect((res.event as { rawType: string }).rawType).toBe('future-thing')
    }
  })

  it('rejects malformed input', () => {
    expect(decodeEvent('not json').ok).toBe(false)
    expect(decodeEvent('[]').ok).toBe(false)
    expect(decodeEvent('42').ok).toBe(false)
    expect(decodeEvent(JSON.stringify({ nope: 1 })).ok).toBe(false)
    expect(decodeEvent(JSON.stringify({ type: 'message', id: 'm1' })).ok).toBe(false) // missing role/content
  })

  it('rejects known-type events with wrong id types', () => {
    expect(decodeEventObject({ type: 'delta', id: 5, seq: 1, text: 'x' }).ok).toBe(false)
  })
})

describe('commands', () => {
  it('round-trips all command shapes', () => {
    const cmds = [
      decodeCommand(encodeCommand({ type: 'send-message', conversationId: 'cv', content: 'hi' })),
      decodeCommand(encodeCommand({ type: 'cancel', runId: 'r' })),
      decodeCommand(encodeCommand({ type: 'retry', runId: 'r' })),
      decodeCommand(encodeCommand({ type: 'approve', approvalId: 'a', allowed: true })),
      decodeCommand(encodeCommand({ type: 'ping' }))
    ]
    expect(cmds.map((x) => x.type)).toEqual(['send-message', 'cancel', 'retry', 'approve', 'ping'])
  })

  it('rejects malformed commands', () => {
    expect(() => decodeCommand('nope')).toThrow()
    expect(() => decodeCommand(JSON.stringify({ type: 'cancel' }))).toThrow()
    expect(() => decodeCommand(JSON.stringify({ type: 'bogus' }))).toThrow()
  })
})

describe('error classification', () => {
  it('classifies rate limit, timeout, network, auth, context overflow', () => {
    expect(classifyError(new Error('rate limit exceeded (429)')).code).toBe('rate_limit')
    expect(classifyError(new Error('request timed out')).code).toBe('timeout')
    expect(classifyError(new Error('fetch failed')).code).toBe('network')
    expect(classifyError(new Error('invalid api key')).code).toBe('auth')
    expect(classifyError(new Error('context length exceeded')).code).toBe('context_overflow')
    expect(classifyError(new Error('mystery')).code).toBe('unknown')
  })

  it('marks retryable codes', () => {
    expect(isRetryable('rate_limit')).toBe(true)
    expect(isRetryable('timeout')).toBe(true)
    expect(isRetryable('network')).toBe(true)
    expect(isRetryable('auth')).toBe(false)
    expect(isRetryable('context_overflow')).toBe(false)
    expect(isRetryable('unknown')).toBe(false)
  })
})
