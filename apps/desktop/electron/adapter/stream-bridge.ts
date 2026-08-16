/**
 * M5 — StreamBridge with reconnect: reopens the mux WebSocket with bounded
 * exponential backoff and backfills missed events from history using the
 * last-seen seq (official v1 semantics: reconnect = reopen stream + refetch
 * history; `since` resume is unimplemented upstream).
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

export type StreamState = {
  running: boolean
  reconnecting?: boolean
  attempt?: number
  error?: string
}

export interface StreamBridgeOptions {
  client: RpcClient
  /** Called with a batch of protocol events (already filtered by session). */
  onEvents: (events: AgentEvent[]) => void
  /** Called when the stream ends or errors (for UI/status feedback). */
  onClose?: (err?: Error) => void
  /** Called on every connection-state change (running/reconnecting). */
  onState?: (state: StreamState) => void
  batchMs?: number
  /** Max reconnect attempts (undefined = keep retrying until stop()). */
  maxReconnects?: number
  backoffMs?: number
}

export class StreamBridge {
  private readonly client: RpcClient
  private readonly onEvents: (events: AgentEvent[]) => void
  private readonly onClose?: (err?: Error) => void
  private readonly onState?: (state: StreamState) => void
  private readonly batchMs: number
  private readonly maxReconnects: number | undefined
  private readonly backoffMs: number
  private activeSessionId: string | null = null
  private controller: AbortController | null = null
  private buffer: AgentEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private running = false
  private stopped = false
  private reconnectAttempt = 0
  /** sessions awaiting a history backfill after reconnect (keyed by sessionId) */
  private needsBackfill = new Set<string>()
  /** last seen seq per session (from subscribed frames + session events). */
  private lastSeenSeq = new Map<string, number>()

  /** rpcId ledger for answerable frames (M4). */
  readonly pending: Map<string, PendingServerRequest> = new Map()
  /** reverse index: approvalId | questionRpcId → rpcId */
  private readonly byId: Map<string, string> = new Map()

  constructor(options: StreamBridgeOptions) {
    this.client = options.client
    this.onEvents = options.onEvents
    this.onClose = options.onClose
    this.onState = options.onState
    this.batchMs = options.batchMs ?? 30
    this.maxReconnects = options.maxReconnects
    this.backoffMs = options.backoffMs ?? 500
  }

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

  setActiveSession(sessionId: string | null): void {
    this.activeSessionId = sessionId
  }

  getActiveSession(): string | null {
    return this.activeSessionId
  }

  isRunning(): boolean {
    return this.running
  }

  /** Start consuming the mux stream with automatic reconnect (idempotent). */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.stopped = false
    try {
      while (!this.stopped) {
        this.controller = new AbortController()
        try {
          for await (const frame of this.client.openSocketStream('/api/events.mux', this.controller.signal)) {
            this.reconnectAttempt = 0
            this.handleFrame(frame)
          }
          // clean end (server closed) — no reconnect, inform the consumer
          this.onClose?.()
          break
        } catch (err) {
          if (this.stopped) break
          this.onClose?.(err instanceof Error ? err : new Error(String(err)))
        }
        if (this.stopped) break

        this.reconnectAttempt++
        if (this.maxReconnects !== undefined && this.reconnectAttempt > this.maxReconnects) break
        const delay = Math.min(this.backoffMs * 2 ** (this.reconnectAttempt - 1), 5_000)
        this.onState?.({ running: false, reconnecting: true, attempt: this.reconnectAttempt })
        await new Promise((r) => setTimeout(r, delay))
        this.onState?.({ running: true, reconnecting: true, attempt: this.reconnectAttempt })
        // backfill is triggered by the session/subscribed baseline of the new
        // connection (after it, lastSeenSeq reflects what the live stream
        // replays, so the backfill only fetches what was actually missed)
        if (this.activeSessionId) this.needsBackfill.add(this.activeSessionId)
      }
    } finally {
      this.running = false
      this.flush()
    }
  }

  /** Stop consuming and flush remaining events. */
  stop(): void {
    this.stopped = true
    this.controller?.abort()
    this.flush()
  }

  /**
   * Backfill events after a reconnect: fetch the history tail and replay
   * events with seq > lastSeenSeq (dedupe). Official v1 has no `since`
   * resume, so this is the documented recovery path.
   */
  private async backfillAndEmit(sessionId: string): Promise<void> {
    try {
      const res = await this.client.unary<{
        events: Array<{ event: { type: string; seq: number; time: number; data: Record<string, unknown> } }>
        hasMore: boolean
      }>('session.history', { sessionId, maxMessages: 100 })

      const missed: AgentEvent[] = []
      for (const entry of res.events) {
        // re-read per entry: the live stream may have advanced lastSeenSeq
        // while the history fetch was in flight (replay of the new baseline)
        const last = this.lastSeenSeq.get(sessionId) ?? -1
        if (entry.event.seq <= last) continue
        this.lastSeenSeq.set(sessionId, entry.event.seq)
        const mapped = mapSessionEvent({
          type: 'session/event',
          sessionId,
          event: entry.event
        })
        if (mapped) missed.push(mapped)
      }
      if (missed.length > 0) this.onEvents(missed)
    } catch {
      /* history backfill failure is non-fatal; live stream continues */
    }
  }

  private handleFrame(frame: ServerRequest<MuxFrame>): void {
    const payload = frame.payload
    switch (payload.type) {
      case 'session/event': {
        if (this.activeSessionId && payload.sessionId !== this.activeSessionId) return
        this.lastSeenSeq.set(payload.sessionId, Math.max(this.lastSeenSeq.get(payload.sessionId) ?? -1, payload.event.seq))
        const mapped = mapSessionEvent(payload)
        if (mapped) this.enqueue(mapped)
        return
      }
      case 'session/subscribed': {
        // baseline for reconnect bookkeeping (M5)
        this.lastSeenSeq.set(payload.sessionId, Math.max(this.lastSeenSeq.get(payload.sessionId) ?? -1, payload.lastSeq))
        // the live stream has now replayed its baseline — backfill what was
        // missed since our last seen seq
        if (this.needsBackfill.delete(payload.sessionId)) {
          void this.backfillAndEmit(payload.sessionId)
        }
        return
      }
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
        return // host-level frames, queue snapshots: ignored
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
