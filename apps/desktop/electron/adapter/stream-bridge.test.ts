import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@dshd/protocol'
import { StreamBridge } from './stream-bridge'
import type { RpcClient } from './rpc-client'
import type { MuxFrame, ServerRequest } from './wire-types'

function frame(payload: MuxFrame, rpcId = 'r'): ServerRequest<MuxFrame> {
  return { type: 'server-request', rpcId, method: 'events.mux', payload }
}

function fakeClient(frames: Array<ServerRequest<MuxFrame>>, delayMs = 0): RpcClient {
  return {
    openSocketStream: async function* () {
      for (const f of frames) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        yield f
      }
    }
  } as unknown as RpcClient
}

describe('StreamBridge', () => {
  it('maps and batches session events for the active session only', async () => {
    const onEvents = vi.fn()
    const frames = [
      frame({ type: 'session/event', sessionId: 's1', event: { type: 'assistant/chunk', seq: 1, time: 1, data: { chunk: { delta: 'hel' } } } }),
      frame({ type: 'session/event', sessionId: 's1', event: { type: 'assistant/chunk', seq: 2, time: 1, data: { chunk: { delta: 'lo' } } } }),
      frame({ type: 'session/event', sessionId: 's2', event: { type: 'assistant/chunk', seq: 1, time: 1, data: { chunk: { delta: 'other' } } } })
    ]
    const bridge = new StreamBridge({ client: fakeClient(frames), onEvents, batchMs: 1 })
    bridge.setActiveSession('s1')
    await bridge.start()
    await new Promise((r) => setTimeout(r, 20))

    expect(onEvents).toHaveBeenCalled()
    const all = onEvents.mock.calls.flat(2) as AgentEvent[]
    expect(all.map((e) => e.type)).toEqual(['delta', 'delta'])
    expect(all.map((e) => (e.type === 'delta' ? e.text : ''))).toEqual(['hel', 'lo'])
  })

  it('forwards approval/question frames and records pending rpcIds', async () => {
    const onEvents = vi.fn()
    const frames = [
      frame({ type: 'approval/requested', sessionId: 's1', approvalId: 'a1', toolName: 'bash' }, 'rpc-a'),
      frame({ type: 'question/requested', sessionId: 's1', questions: [{ rpcId: 'q1', question: 'Pick?' }] }, 'rpc-q')
    ]
    const bridge = new StreamBridge({ client: fakeClient(frames), onEvents, batchMs: 1 })
    bridge.setActiveSession('s1')
    await bridge.start()

    const all = onEvents.mock.calls.flat(2) as AgentEvent[]
    expect(all.map((e) => e.type)).toEqual(['approval-request', 'question'])
    expect(bridge.pending.get('rpc-a')).toMatchObject({ kind: 'approval', approvalId: 'a1' })
    expect(bridge.pending.get('rpc-q')).toMatchObject({ kind: 'question', questionRpcId: 'q1' })
  })

  it('ignores subscribed/other sessions and host frames', async () => {
    const onEvents = vi.fn()
    const frames = [
      frame({ type: 'session/subscribed', sessionId: 's1', lastSeq: 5 }),
      frame({ type: 'session/event', sessionId: 's9', event: { type: 'assistant/chunk', seq: 1, time: 1, data: { chunk: { delta: 'x' } } } })
    ]
    const bridge = new StreamBridge({ client: fakeClient(frames), onEvents, batchMs: 1 })
    bridge.setActiveSession('s1')
    await bridge.start()
    expect(onEvents).not.toHaveBeenCalled()
  })

  it('notifies onClose when the stream ends', async () => {
    const onClose = vi.fn()
    const bridge = new StreamBridge({ client: fakeClient([]), onEvents: vi.fn(), onClose })
    await bridge.start()
    expect(onClose).toHaveBeenCalled()
  })

  it('maps resolved frames to resolved events and clears the ledger', async () => {
    const onEvents = vi.fn()
    const frames = [
      frame({ type: 'approval/requested', sessionId: 's1', approvalId: 'a1', toolName: 'bash' }, 'rpc-a'),
      frame({ type: 'approval/resolved', sessionId: 's1', approvalId: 'a1', outcome: 'rejected' }, 'rpc-a2'),
      frame({ type: 'question/requested', sessionId: 's1', questions: [{ rpcId: 'q1', question: 'Pick?' }] }, 'rpc-q'),
      frame({ type: 'question/resolved', sessionId: 's1', questionRpcId: 'q1', outcome: 'cancelled' }, 'rpc-q2')
    ]
    const bridge = new StreamBridge({ client: fakeClient(frames), onEvents, batchMs: 1 })
    bridge.setActiveSession('s1')
    await bridge.start()

    const all = onEvents.mock.calls.flat(2) as AgentEvent[]
    expect(all.map((e) => e.type)).toEqual([
      'approval-request',
      'approval-resolved',
      'question',
      'question-resolved'
    ])
    expect(bridge.pending.size).toBe(0)
    expect(bridge.rpcIdFor('a1')).toBeUndefined()
    expect(bridge.rpcIdFor('q1')).toBeUndefined()
  })

  it('rpcIdFor resolves pending approvals and questions; dropPending removes them', async () => {
    const onEvents = vi.fn()
    const frames = [
      frame({ type: 'approval/requested', sessionId: 's1', approvalId: 'a1', toolName: 'bash' }, 'rpc-a'),
      frame({ type: 'question/requested', sessionId: 's1', questions: [{ rpcId: 'q1', question: 'Pick?' }] }, 'rpc-q')
    ]
    const bridge = new StreamBridge({ client: fakeClient(frames), onEvents, batchMs: 1 })
    bridge.setActiveSession('s1')
    await bridge.start()

    expect(bridge.rpcIdFor('a1')).toBe('rpc-a')
    expect(bridge.rpcIdFor('q1')).toBe('rpc-q')
    bridge.dropPending('a1')
    expect(bridge.rpcIdFor('a1')).toBeUndefined()
    expect(bridge.pending.has('rpc-a')).toBe(false)
    expect(bridge.rpcIdFor('q1')).toBe('rpc-q') // untouched
  })
})
