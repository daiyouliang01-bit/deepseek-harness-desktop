import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@dshd/protocol'
import { decodeEventObject } from '@dshd/protocol'
import { initialState, reduceEvents, resolveApproval } from './event-reducer'

const FIXTURES_DIR = join(__dirname, '../../../../../../../tests/fixtures/events')

function loadFixture(name: string): AgentEvent[] {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8')
  const lines = JSON.parse(raw) as unknown[]
  const events: AgentEvent[] = []
  for (const line of lines) {
    const res = decodeEventObject(line)
    if (!res.ok) throw new Error(`fixture line failed to decode: ${JSON.stringify(line)}`)
    events.push(res.event)
  }
  return events
}

describe('event reducer — fixture replay', () => {
  it('normal answer: one user msg + streaming assistant msg finalized by completion', () => {
    const state = reduceEvents(initialState, loadFixture('normal-answer'))
    expect(state.messages).toHaveLength(2)
    expect(state.messages[0]).toMatchObject({ role: 'user', content: 'What is 2+2?' })
    expect(state.messages[1].content).toBe('2+2 equals 4.')
    expect(state.messages[1].streaming).toBe(false)
    expect(state.completions['run1']).toBeDefined()
  })

  it('tool loop: tool calls attach to the assistant turn with resolved statuses', () => {
    const state = reduceEvents(initialState, loadFixture('tool-loop'))
    const assistant = state.messages[state.messages.length - 1]
    expect(assistant.role).toBe('assistant')
    expect(assistant.toolCalls).toHaveLength(2)
    expect(assistant.toolCalls[0]).toMatchObject({ callId: 'c1', name: 'bash', status: 'ok' })
    expect(assistant.toolCalls[1]).toMatchObject({ callId: 'c2', name: 'read', status: 'ok', output: 'hello' })
    expect(assistant.streaming).toBe(false)
  })

  it('parallel tools: preserves all calls and matches results by callId regardless of order', () => {
    const state = reduceEvents(initialState, loadFixture('parallel-tools'))
    const assistant = state.messages[state.messages.length - 1]
    expect(assistant.toolCalls).toHaveLength(3)
    const byId = Object.fromEntries(assistant.toolCalls.map((t) => [t.callId, t.status]))
    expect(byId).toEqual({ p1: 'ok', p2: 'ok', p3: 'ok' })
  })

  it('cancellation: approval surfaces, then error attaches and turn stops streaming', () => {
    const state = reduceEvents(initialState, loadFixture('cancellation'))
    expect(state.approvals).toHaveLength(1)
    expect(state.approvals[0]).toMatchObject({ permission: 'shell:execute' })
    const assistant = state.messages[state.messages.length - 1]
    expect(assistant.errors[0]).toMatchObject({ code: 'cancelled', retryable: false })
    expect(assistant.streaming).toBe(false)
  })

  it('rate limit error: surfaces a retryable error with hint on the turn', () => {
    const state = reduceEvents(initialState, loadFixture('rate-limit-error'))
    const assistant = state.messages[state.messages.length - 1]
    expect(assistant.errors[0]).toMatchObject({ code: 'rate_limit', retryable: true })
    expect(assistant.errors[0].hint).toBeTruthy()
  })

  it('reconnect: later deltas append to the existing turn without duplicate messages', () => {
    const state = reduceEvents(initialState, loadFixture('reconnect'))
    expect(state.messages).toHaveLength(2)
    expect(state.messages[1].content).toBe('Reconnecting…As I was saying, the answer is 42.')
  })
})

describe('event reducer — invariants', () => {
  it('tolerates unknown events without changing state', () => {
    const state = reduceEvents(initialState, [{ type: 'unknown', rawType: 'future-x', payload: {} }])
    expect(state).toEqual(initialState)
  })

  it('completion without prior turn records completion only', () => {
    const state = reduceEvents(initialState, [
      { type: 'completion', id: 'r', usage: { tokens: 5 } }
    ])
    expect(state.messages).toHaveLength(1) // synthetic assistant turn
    expect(state.messages[0].streaming).toBe(false)
    expect(state.completions['r'].usage?.tokens).toBe(5)
  })

  it('resolveApproval removes the pending approval', () => {
    let state = reduceEvents(initialState, [
      { type: 'approval-request', id: 'a1', permission: 'file:write' }
    ])
    expect(state.approvals).toHaveLength(1)
    state = resolveApproval(state, 'a1')
    expect(state.approvals).toHaveLength(0)
  })

  it('is pure: input state is not mutated', () => {
    const before = JSON.stringify(initialState)
    reduceEvents(initialState, loadFixture('tool-loop'))
    expect(JSON.stringify(initialState)).toBe(before)
  })
})

describe('fixture corpus completeness', () => {
  it('all six planned scenarios exist', () => {
    const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'))
    for (const expected of ['normal-answer', 'tool-loop', 'parallel-tools', 'cancellation', 'rate-limit-error', 'reconnect']) {
      expect(files).toContain(`${expected}.json`)
    }
  })
})
