import { describe, expect, it, vi } from 'vitest'
import { mapControlFrame, mapSessionEvent } from './event-mapper'
import { parseWsFrame, RpcClient } from './rpc-client'
import type { MuxFrame, ServerRequest } from './wire-types'

function envelope(payload: MuxFrame, rpcId = 'rpc-1'): ServerRequest<MuxFrame> {
  return { type: 'server-request', rpcId, method: 'events.mux', payload }
}

describe('RpcClient unary', () => {
  it('posts the client-request envelope and verifies rpcId echo', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { type: string; rpcId: string; method: string }
      expect(url.toString()).toBe('http://127.0.0.1:1/api/session.list')
      expect(body).toMatchObject({ type: 'client-request', method: 'session.list' })
      return new Response(
        JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: [{ id: 's1' }] } }),
        { status: 200 }
      )
    })
    const client = new RpcClient({ baseUrl: 'http://127.0.0.1:1', fetchImpl: fetchMock as typeof fetch })
    const value = await client.unary<Array<{ id: string }>>('session.list', {})
    expect(value).toEqual([{ id: 's1' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws RpcError with code on failed results', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { rpcId: string }
      return new Response(
        JSON.stringify({
          type: 'server-response',
          rpcId: body.rpcId,
          result: { ok: false, error: { code: 'session-not-found', message: 'nope' } }
        }),
        { status: 200 }
      )
    })
    const client = new RpcClient({ baseUrl: 'http://127.0.0.1:1', fetchImpl: fetchMock as typeof fetch })
    await expect(client.unary('session.history', {})).rejects.toMatchObject({ code: 'session-not-found' })
  })

  it('throws on rpcId mismatch', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ type: 'server-response', rpcId: 'other', result: { ok: true, value: null } }), {
        status: 200
      })
    )
    const client = new RpcClient({ baseUrl: 'http://127.0.0.1:1', fetchImpl: fetchMock as typeof fetch })
    await expect(client.unary('session.list', {})).rejects.toThrow(/rpcId mismatch/)
  })
})

describe('WebSocket frame parsing', () => {
  it('parses a valid server-request envelope', () => {
    const parsed = parseWsFrame(JSON.stringify(envelope({ type: 'session/subscribed', sessionId: 's1', lastSeq: 7 })), '/api/events.mux')
    expect(parsed?.payload).toMatchObject({ type: 'session/subscribed', lastSeq: 7 })
  })

  it('drops corrupt frames (bad JSON, wrong envelope, binary)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(parseWsFrame('not-json', '/api/events.mux')).toBeNull()
    expect(parseWsFrame(JSON.stringify({ type: 'server-response', rpcId: 'x', result: { ok: true } }), '/api/events.mux')).toBeNull()
    expect(parseWsFrame(new Uint8Array([1, 2]), '/api/events.mux')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('tolerates unknown frame types inside the payload', () => {
    const parsed = parseWsFrame(
      JSON.stringify({ type: 'server-request', rpcId: 'r', method: 'events.mux', payload: { type: 'future/thing', x: 1 } }),
      '/api/events.mux'
    )
    expect(parsed?.payload).toMatchObject({ type: 'future/thing' })
  })
})

describe('RpcClient respond', () => {
  it('respond posts to /api/respond and parses the receipt', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(url.toString()).toBe('http://127.0.0.1:1/api/respond')
      return new Response(JSON.stringify({ accepted: true }), { status: 200 })
    })
    const client = new RpcClient({ baseUrl: 'http://127.0.0.1:1', fetchImpl: fetchMock as typeof fetch })
    const receipt = await client.respond({ type: 'client-response', rpcId: 'r1', result: { ok: true, value: { approvalId: 'a', outcome: 'allowed-once' } } })
    expect(receipt).toEqual({ accepted: true })
  })
})

describe('event mapper', () => {
  it('maps assistant chunks to deltas with session seqs', () => {
    const ev = mapSessionEvent({
      type: 'session/event',
      sessionId: 's1',
      event: { type: 'assistant/chunk', seq: 5, time: 100, data: { chunk: { delta: 'hi' } } }
    })
    expect(ev).toEqual({ type: 'delta', id: 's1:5', seq: 5, text: 'hi' })
  })

  it('maps user/assistant messages and tool lifecycle', () => {
    expect(
      mapSessionEvent({
        type: 'session/event',
        sessionId: 's1',
        event: { type: 'user/message', seq: 1, time: 1, data: { content: 'hello' } }
      })
    ).toMatchObject({ type: 'message', role: 'user', content: 'hello' })
    expect(
      mapSessionEvent({
        type: 'session/event',
        sessionId: 's1',
        event: { type: 'tool/call', seq: 2, time: 1, data: { callId: 'c1', name: 'bash', args: { cmd: 'ls' } } }
      })
    ).toMatchObject({ type: 'tool-call', callId: 'c1', name: 'bash' })
    expect(
      mapSessionEvent({
        type: 'session/event',
        sessionId: 's1',
        event: { type: 'tool/result', seq: 3, time: 1, data: { callId: 'c1', ok: true, output: 'x' } }
      })
    ).toMatchObject({ type: 'tool-result', callId: 'c1', ok: true, output: 'x' })
  })

  it('maps errors through the classifier', () => {
    const ev = mapSessionEvent({
      type: 'session/event',
      sessionId: 's1',
      event: { type: 'error', seq: 9, time: 1, data: { error: { kind: 'error', message: 'rate limit exceeded (429)' } } }
    })
    expect(ev).toMatchObject({ type: 'error', code: 'rate_limit', retryable: true })
  })

  it('returns null for unknown/ignorable events (tolerance)', () => {
    expect(
      mapSessionEvent({
        type: 'session/event',
        sessionId: 's1',
        event: { type: 'compaction/start', seq: 10, time: 1, data: {}, ignorable: true }
      })
    ).toBeNull()
  })

  it('maps control frames to approval/question protocol events with pending bookkeeping', () => {
    const approval = mapControlFrame(
      { type: 'approval/requested', sessionId: 's1', approvalId: 'a1', toolName: 'bash', callId: 'c1' },
      'rpc-1'
    )
    expect(approval.events[0]).toMatchObject({ type: 'approval-request', id: 'a1', permission: 'tool:bash' })
    expect(approval.pending).toEqual([{ rpcId: 'rpc-1', kind: 'approval', approvalId: 'a1' }])

    const question = mapControlFrame(
      { type: 'question/requested', sessionId: 's1', questions: [{ rpcId: 'q1', question: 'Pick one', options: [{ label: 'A', value: 'a' }] }] },
      'rpc-2'
    )
    expect(question.events[0]).toMatchObject({ type: 'question', question: 'Pick one' })
    expect(question.pending).toEqual([{ rpcId: 'rpc-2', kind: 'question', questionRpcId: 'q1' }])
  })
})
