/**
 * M2 — session domain adapter: typed session operations over the wire client,
 * with local SQLite cache and history → protocol-event mapping.
 */

import type { AgentEvent } from '@dshd/protocol'
import { SessionStore } from '@dshd/session-store'
import { mapSessionEvent } from './event-mapper'
import { RpcClient } from './rpc-client'

export interface SessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  title?: string
}

export interface SessionSearchResult {
  sessionId: string
  snippet: string
}

export interface HistoryPage {
  events: AgentEvent[]
  hasMore: boolean
  lastSeq: number
}

export interface SessionAdapterOptions {
  client: RpcClient
  /** Local cache store (owned by the caller; the adapter never closes it). */
  store: SessionStore
}

/** v1 note: session.delete is not part of the official surface; archiving is local-only. */
export class SessionAdapter {
  constructor(private readonly options: SessionAdapterOptions) {}

  private get client(): RpcClient {
    return this.options.client
  }
  private get store(): SessionStore {
    return this.options.store
  }

  /** List remote sessions, upsert into cache, return summaries. */
  async list(): Promise<SessionSummary[]> {
    const res = await this.client.unary<{ items: SessionSummary[] }>('session.list', {})
    for (const item of res.items) {
      this.store.upsertConversation(item.sessionId, item.title ?? '', item.updatedAt)
    }
    return res.items
  }

  /** Create a session (optionally pinned cwd). */
  async create(cwd?: string): Promise<{ sessionId: string }> {
    const res = await this.client.unary<{ sessionId: string; agentPreset?: string }>(
      'session.create',
      cwd ? { cwd } : {}
    )
    this.store.upsertConversation(res.sessionId, '', Date.now())
    return { sessionId: res.sessionId }
  }

  /** Fetch a history page and map raw events to protocol events. */
  async history(sessionId: string, beforeSeq?: number, maxMessages = 50): Promise<HistoryPage> {
    const res = await this.client.unary<{
      events: Array<{ event: { type: string; seq: number; time: number; data: Record<string, unknown> } }>
      hasMore: boolean
    }>('session.history', { sessionId, beforeSeq, maxMessages })

    const events: AgentEvent[] = []
    let lastSeq = -1
    for (const entry of res.events) {
      lastSeq = Math.max(lastSeq, entry.event.seq)
      const mapped = mapSessionEvent({
        type: 'session/event',
        sessionId,
        event: entry.event
      })
      if (mapped) events.push(mapped)
    }
    return { events, hasMore: res.hasMore, lastSeq }
  }

  /** Rename a session; returns the accepted title. */
  async rename(sessionId: string, title: string): Promise<string> {
    const res = await this.client.unary<{ title: string }>('session.rename', { sessionId, title })
    this.store.renameConversation(sessionId, res.title)
    return res.title
  }

  /** Send a prompt to a session (mode 'steer' interrupts; 'queue' enqueues). */
  async prompt(sessionId: string, text: string, mode: 'queue' | 'steer' = 'steer'): Promise<void> {
    await this.client.unary<{ accepted: true }>('session.prompt', {
      sessionId,
      mode,
      content: [{ type: 'text', text }]
    })
  }

  /** Cancel a session's active turn (pending inbox work resumes FIFO). */
  async cancel(sessionId: string): Promise<void> {
    await this.client.unary<{ accepted: true }>('session.cancel', { sessionId })
  }

  /** Answer a pending approval (echo the server-request's rpcId). */
  async respondApproval(rpcId: string, sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    await this.client.respond({
      type: 'client-response',
      rpcId,
      result: { ok: true, value: { sessionId, approvalId, outcome } }
    })
  }

  /** Answer a pending question (echo the server-request's rpcId). */
  async respondQuestion(rpcId: string, sessionId: string, answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> }): Promise<void> {
    await this.client.respond({
      type: 'client-response',
      rpcId,
      result: { ok: true, value: { sessionId, answer } }
    })
  }

  /**
   * Search message content across sessions. Remote search may be disabled in
   * the deployment (session-query index openAt "never") — fall back to the
   * local FTS cache in that case.
   */
  async search(query: string): Promise<SessionSearchResult[]> {
    try {
      const res = await this.client.unary<{ items: SessionSearchResult[] }>('session.search', { query })
      return res.items
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/search is disabled|SessionQueryError/i.test(msg)) {
        // local FTS fallback over cached messages; FTS5 treats '-' etc. as
        // operators, so quote each token as a phrase term.
        const tokens = query.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '')}"`)
        if (tokens.length === 0) return []
        return this.store.searchMessages(tokens.join(' ')).map((hit) => ({
          sessionId: hit.conversationId,
          snippet: hit.snippet
        }))
      }
      throw err
    }
  }

  /** Local archive (no official session.delete exists). */
  archive(sessionId: string): void {
    this.store.setArchived(sessionId, true)
  }

  /** Un-archive a session. */
  unarchive(sessionId: string): void {
    this.store.setArchived(sessionId, false)
  }
}
