/**
 * M1 — Harness wire client: HTTP POST unary (upstream) + SSE streams (down).
 *
 * Mirrors the official client's physical layer: unary = POST /api/<method>
 * with a client-request envelope and rpcId echo verification; streams = GET
 * /api/events.mux|host with '\n\n'-framed server-request envelopes. One
 * corrupt frame is skipped and logged (gap detection is the consumer's job),
 * matching the official readSse behavior.
 */

import type { ClientRequest, ClientResponse, MuxFrame, ServerRequest, ServerResponse } from './wire-types'

export interface RpcClientOptions {
  baseUrl: string
  timeoutMs?: number
  onEnvelope?: (env: unknown) => void
  fetchImpl?: typeof fetch
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

export class RpcClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly onEnvelope?: (env: unknown) => void
  private readonly fetchImpl: typeof fetch

  constructor(options: RpcClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.onEnvelope = options.onEnvelope
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private mintRpcId(): string {
    return crypto.randomUUID()
  }

  /** Unary call: POST /api/<method>, verify rpcId echo, tolerant parse. */
  async unary<V>(method: string, payload: unknown): Promise<V> {
    const rpcId = this.mintRpcId()
    const message: ClientRequest = { type: 'client-request', rpcId, method, payload }
    this.onEnvelope?.(message)

    const response = await this.fetchImpl(`${this.baseUrl}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!response.ok) throw new Error(`transport failure for ${method}: HTTP ${response.status}`)

    const full = (await response.json()) as ServerResponse
    this.onEnvelope?.(full)
    if (full.type !== 'server-response') throw new Error(`unexpected envelope type '${(full as { type?: string }).type}'`)
    if (full.rpcId !== rpcId) throw new Error(`rpcId mismatch for ${method}: sent ${rpcId}, got ${full.rpcId}`)
    if (!full.result.ok) {
      const e = full.result.error
      throw new RpcError(e.message, e.code, e.details)
    }
    return full.result.value as V
  }

  /**
   * Open the mux (or host) event stream over WebSocket.
   * The official server answers plain GET with 426 and requires the WS
   * upgrade; the WS is downlink-only — no client payload is sent in v1
   * (resume/since is unimplemented upstream). Each message is a JSON
   * server-request envelope; malformed frames are dropped with a warning.
   */
  async *openSocketStream(path: '/api/events.mux' | '/api/events.host', signal?: AbortSignal): AsyncGenerator<ServerRequest<MuxFrame>> {
    const url = new URL(path, this.baseUrl)
    url.protocol = this.baseUrl.startsWith('https:') ? 'wss:' : 'ws:'

    const socket = new WebSocket(url)
    const inbox: Array<ServerRequest<MuxFrame>> = []
    let wake: (() => void) | undefined
    let ended = false
    let error: Error | undefined

    const enqueue = (item: ServerRequest<MuxFrame>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const fail = (err: Error): void => {
      error = err
      ended = true
      wake?.()
      wake = undefined
    }

    socket.addEventListener('open', () => {
      this.onEnvelope?.({ ws: 'open', path })
    })
    socket.addEventListener('message', (event: MessageEvent) => {
      const parsed = parseWsFrame(event.data, path)
      if (parsed) {
        this.onEnvelope?.(parsed)
        enqueue(parsed)
      }
    })
    socket.addEventListener('close', () => {
      ended = true
      wake?.()
      wake = undefined
    })
    socket.addEventListener('error', () => {
      fail(new Error(`WebSocket error on ${path}`))
    })

    const abort = (): void => {
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close()
    }
    signal?.addEventListener('abort', abort, { once: true })

    try {
      while (!ended) {
        if (inbox.length > 0) {
          yield inbox.shift() as ServerRequest<MuxFrame>
          continue
        }
        if (error) throw error
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    } finally {
      signal?.removeEventListener('abort', abort)
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
    }
  }

  /** Answer a server-request frame (approval/question) via POST /api/respond. */
  async respond(response: ClientResponse): Promise<{ accepted: boolean; reason?: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(response),
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!res.ok) throw new Error(`respond transport failure: HTTP ${res.status}`)
    return (await res.json()) as { accepted: boolean; reason?: string }
  }
}

/**
 * Parse one WebSocket message into a server-request envelope.
 * Returns null for corrupt frames (JSON parse failure, wrong envelope type,
 * or non-string payload) — one bad frame must not kill the stream.
 */
export function parseWsFrame(data: unknown, path: string): ServerRequest<MuxFrame> | null {
  try {
    if (typeof data !== 'string') throw new Error('binary WebSocket frame')
    const parsed = JSON.parse(data) as ServerRequest<MuxFrame>
    if (parsed.type !== 'server-request') throw new Error(`unexpected envelope type '${(parsed as { type?: string }).type}'`)
    if (typeof parsed.payload !== 'object' || parsed.payload === null) throw new Error('missing frame payload')
    return parsed
  } catch (err) {
    console.warn(`[adapter] dropping malformed WebSocket frame on ${path}:`, err instanceof Error ? err.message : String(err))
    return null
  }
}
