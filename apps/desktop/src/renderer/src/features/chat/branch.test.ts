import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './event-reducer'
import {
  appendToBranch,
  editMessage,
  materialize,
  regenerate,
  selectBranch
} from './branch'
import { DEFAULT_INSTRUCTIONS, effectiveSystemPrompt, loadInstructions, saveInstructions } from '../settings/custom-instructions'

function msg(id: string, content: string, role: 'user' | 'assistant' = 'assistant'): ChatMessage {
  return { id, role, content, streaming: false, toolCalls: [], errors: [], ts: 0 }
}

const m1 = msg('m1', 'hi', 'user')
const base = [m1, msg('m2', 'answer A')]

describe('conversation branching', () => {
  it('regenerate truncates after the anchor and opens a branch', () => {
    const { messages, branchState, anchorId } = regenerate({}, base, 'm1')
    expect(messages.map((m) => m.id)).toEqual(['m1'])
    expect(anchorId).toBe('m1')
    expect(branchState['m1'].branches).toHaveLength(1)
  })

  it('streaming appends go to the selected branch; regenerate opens a new one', () => {
    let bs = regenerate({}, base, 'm1').branchState
    bs = appendToBranch(bs, 'm1', msg('m2', 'answer A'))
    expect(bs['m1'].branches[0].map((m) => m.id)).toEqual(['m2'])
    expect(materialize([m1], bs).map((m) => m.content)).toEqual(['hi', 'answer A'])

    // regenerate again → second branch selected
    const next = regenerate(bs, [m1], 'm1')
    expect(next.branchState['m1'].branches).toHaveLength(2)
    expect(next.branchState['m1'].selected).toBe(1)
    bs = appendToBranch(next.branchState, 'm1', msg('m3', 'answer B'))
    expect(bs['m1'].branches[1].map((m) => m.id)).toEqual(['m3'])
    expect(materialize([m1], bs).map((m) => m.content)).toEqual(['hi', 'answer B'])
  })

  it('selectBranch switches the visible continuation', () => {
    let bs = regenerate({}, base, 'm1').branchState
    bs = appendToBranch(bs, 'm1', msg('m2', 'A'))
    bs = regenerate(bs, [m1], 'm1').branchState
    bs = appendToBranch(bs, 'm1', msg('m3', 'B'))
    expect(materialize([m1], bs).map((m) => m.content)).toEqual(['hi', 'B'])
    bs = selectBranch(bs, 'm1', 0)
    expect(materialize([m1], bs).map((m) => m.content)).toEqual(['hi', 'A'])
  })

  it('editMessage replaces content in place', () => {
    const edited = editMessage(base, 'm2', 'answer A (edited)')
    expect(edited[1].content).toBe('answer A (edited)')
    // immutability: original untouched
    expect(base[1].content).toBe('answer A')
  })

  it('selectBranch ignores out-of-range indexes', () => {
    let bs = regenerate({}, base, 'm1').branchState
    bs = appendToBranch(bs, 'm1', msg('m2', 'x'))
    expect(selectBranch(bs, 'm1', 5)).toBe(bs)
  })

  it('materialize supports nested anchors', () => {
    let bs = regenerate({}, base, 'm1').branchState
    bs = appendToBranch(bs, 'm1', msg('m2', 'A1'))
    // nested: branch from the branched message m2
    bs = { ...bs, ['m2']: { anchorId: 'm2', branches: [[msg('m3', 'A1-deep')]], selected: 0 } }
    const view = materialize([m1], bs)
    expect(view.map((m) => m.content)).toEqual(['hi', 'A1', 'A1-deep'])
  })
})

describe('custom instructions', () => {
  const memory = new Map<string, string>()
  const get = (k: string) => memory.get(k) ?? null
  const set = (k: string, v: string) => void memory.set(k, v)

  it('defaults to disabled with empty prompt', () => {
    expect(loadInstructions(get)).toEqual(DEFAULT_INSTRUCTIONS)
  })

  it('saves and loads instructions', () => {
    saveInstructions(set, { systemPrompt: 'Be concise.', enabled: true })
    expect(loadInstructions(get)).toEqual({ systemPrompt: 'Be concise.', enabled: true })
  })

  it('effectiveSystemPrompt includes the conversation title when set', () => {
    const ins = { systemPrompt: 'Be concise.', enabled: true }
    expect(effectiveSystemPrompt(ins, 'My Chat')).toContain('My Chat')
    expect(effectiveSystemPrompt(ins, '')).toBe('Be concise.')
    expect(effectiveSystemPrompt({ ...ins, enabled: false }, 'x')).toBe('')
  })

  it('tolerates corrupt stored JSON', () => {
    memory.set('custom-instructions', '{broken')
    expect(loadInstructions(get)).toEqual(DEFAULT_INSTRUCTIONS)
  })
})
