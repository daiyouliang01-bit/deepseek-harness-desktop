/**
 * M3 — stream bridge: consumes the mux WebSocket stream in the main process,
 * maps frames to protocol events, batches deltas (30ms) and pushes them to
 * the renderer via a callback. Filters by the active session; keeps an
 * rpcId ledger for answerable frames (approval/question) for M4.
 */

import type { AgentEvent } from '@dshd/protocol'
import { mapControlFrame, mapSessionEvent } from './event-mapper'
import { RpcClient } from './rpc-client'
import type { MuxFrame, ServerRequest } from './wire-types'

export interface PendingServerRequest {
  rpcId: string
  kind: 'approval' | 'question'
  approvalId?: string
  questionRpcId?: string
}

export interface StreamBridgeOptions {
  client: RpcClient
  /** Called with a batch of protocol events (already filtered by session). */
  onEvents: (events: AgentEvent[]) => void
  /** Called when the stream ends or errors (for UI/status feedback). */
  onClose?: (err?: Error) => void
  batchMs?: number
}

export class StreamBridge {
  private readonly client: RpcClient
  private readonly onEvents: (events: AgentEvent[]) => void
  private readonly onClose?: (err?: Error) => void
  private readonly batchMs: number
  private activeSessionId: string | null = null
  private controller: AbortController | null = null
  private buffer: AgentEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private running = false

  /** rpcId ledger for answerable frames (M4). */
  readonly pending: Map<string, PendingServerRequest> = new Map()
  /** reverse index: approvalId | questionRpcId → rpcId */
  private readonly byId: Map<string, string> = new Map()

  /** Resolve the rpcId for a pending approval/question by its resource id. */
  rpcIdFor(resourceId: string): string | undefined {
    return this.byId.get(resourceId)
  }

  /** Drop a ledger entry after a successful respond. */
  dropPending(resourceId: string): void {
    const rpcId = this.byId.get(resourceId)
    if (rpcId) {
      this.byId.delete(resourceId)
      this.pending.delete(rpcId)
    }
  }

  constructor(options: StreamBridgeOptions) {
    this.client = options.client
    this.onEvents = options.onEvents
    this.onClose = options.onClose
    this.batchMs = options.batchMs ?? 30
  }

  setActiveSession(sessionId: string | null): void {
    this.activeSessionId = sessionId
  }

  getActiveSession(): string | null {
    return this.activeSessionId
  }

  isRunning(): boolean {
    return this.running
  }

  /** Start consuming the mux stream (idempotent). */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.controller = new AbortController()
    try {
      for await (const frame of this.client.openSocketStream('/api/events.mux', this.controller.signal)) {
        this.handleFrame(frame)
      }
      this.onClose?.()
    } catch (err) {
      this.onClose?.(err instanceof Error ? err : new Error(String(err)))
    } finally {
      this.running = false
      this.flush()
    }
  }

  /** Stop consuming and flush remaining events. */
  stop(): void {
    this.controller?.abort()
    this.running = false
    this.flush()
  }

  private handleFrame(frame: ServerRequest<MuxFrame>): void {
    const payload = frame.payload
    switch (payload.type) {
      case 'session/event': {
        if (this.activeSessionId && payload.sessionId !== this.activeSessionId) return
        const mapped = mapSessionEvent(payload)
        if (mapped) this.enqueue(mapped)
        return
      }
      case 'session/subscribed':
        return // baseline handled elsewhere (M5 reconnect bookkeeping)
      case 'approval/requested': {
        if (this.activeSessionId && payload.sessionId !== this.activeSessionId) return
        const res = mapControlFrame(payload, frame.rpcId)
        for (const p of res.pending) {
          this.pending.set(p.rpcId, p)
          if (p.approvalId) this.byId.set(p.approvalId, p.rpcId)
        }
        for (const e of res.events) this.enqueue(e)
        return
      }
      case 'question/requested': {
        if (this.activeSessionId && payload.sessionId !== this.activeSessionId) return
        const res = mapControlFrame(payload, frame.rpcId)
        for (const p of res.pending) {
          this.pending.set(p.rpcId, p)
          if (p.questionRpcId) this.byId.set(p.questionRpcId, p.rpcId)
        }
        for (const e of res.events) this.enqueue(e)
        return
      }
      case 'approval/resolved': {
        if (this.activeSessionId && payload.sessionId !== this.activeSessionId) return
        this.dropPending(payload.approvalId)
        this.enqueue({ type: 'approval-resolved', id: payload.approvalId, outcome: payload.outcome })
        return
      }
      case 'question/resolved': {
        if (this.activeSessionId && payload.sessionId !== this.activeSessionId) return
        this.dropPending(payload.questionRpcId)
        this.enqueue({ type: 'question-resolved', id: payload.questionRpcId, outcome: payload.outcome })
        return
      }
      default:
        return // host-level frames, queue snapshots: ignored in M3/M4
    }
  }

  private enqueue(event: AgentEvent): void {
    this.buffer.push(event)
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.batchMs)
    }
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.buffer.length === 0) return
    const batch = this.buffer
    this.buffer = []
    this.onEvents(batch)
  }
}
