/**
 * M2 — session domain adapter: typed session operations over the wire client,
 * with local SQLite cache and history → protocol-event mapping.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

function parsePersistedTask(raw: string): { phase?: string; verifyOk?: boolean } | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; phase?: unknown; lastVerify?: Array<{ ok?: unknown }> }
    if (parsed.version !== 1 || typeof parsed.phase !== 'string') return null
    const lastVerify = parsed.lastVerify
    const verifyOk = Array.isArray(lastVerify) && lastVerify.length > 0 ? lastVerify.every((item) => item.ok === true) : undefined
    return { phase: parsed.phase, verifyOk }
  } catch {
    return null
  }
}

export interface SessionAdapterOptions {
  client: RpcClient
  /** Local cache store (owned by the caller; the adapter never closes it). */
  store: SessionStore
}

/** v1 note: session.delete is not part of the official surface; archiving is local-only. */
export class SessionAdapter {
  readonly #cwds = new Map<string, string>()

  constructor(private readonly options: SessionAdapterOptions) {}

  private get client(): RpcClient {
    return this.options.client
  }
  private get store(): SessionStore {
    return this.options.store
  }

  /** List remote sessions, upsert into cache, return summaries (archived hidden). */
  async list(): Promise<SessionSummary[]> {
    const res = await this.client.unary<{ items: SessionSummary[] }>('session.list', {})
    for (const item of res.items) {
      this.store.upsertConversation(item.sessionId, item.title ?? '', item.updatedAt)
    }
    return res.items.filter((item) => !this.store.isArchived(item.sessionId))
  }

  /** Locally archived sessions, newest first (settings page). */
  listArchived(): SessionSummary[] {
    return this.store.listArchived().map((c) => ({
      sessionId: c.id,
      updatedAt: c.updatedAt,
      running: false,
      blank: false,
      title: c.title || undefined,
    }))
  }

  /** Create a session (optionally pinned cwd). */
  async create(cwd?: string): Promise<{ sessionId: string }> {
    const res = await this.client.unary<{ sessionId: string; agentPreset?: string }>(
      'session.create',
      cwd ? { cwd } : {}
    )
    this.store.upsertConversation(res.sessionId, '', Date.now())
    if (cwd) this.#cwds.set(res.sessionId, cwd)
    return { sessionId: res.sessionId }
  }

  /** Read the coding-agent task sidecar written under the session cwd. */
  readTaskStatus(sessionId: string): { phase?: string; verifyOk?: boolean } | null {
    const cwd = this.#cwds.get(sessionId)
    if (!cwd) return null
    try {
      const raw = readFileSync(join(cwd, '.dsh', 'tasks', `${sessionId}.json`), 'utf8')
      return parsePersistedTask(raw)
    } catch {
      return null
    }
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

  /**
   * Send a prompt with image attachments (M1). Images are preflighted and
   * base64-encoded by the caller (main process); content parts include
   * text + image parts. Returns the intake result for UI feedback.
   */
  async promptWithImages(
    sessionId: string,
    text: string,
    images: Array<{ name: string; mediaType: string; dataB64: string }>,
    mode: 'queue' | 'steer' = 'steer'
  ): Promise<void> {
    const content: Array<Record<string, unknown>> = []
    if (text.trim()) content.push({ type: 'text', text })
    for (const img of images) {
      content.push({ type: 'image', mediaType: img.mediaType, data: img.dataB64, name: img.name })
    }
    await this.client.unary<{ accepted: true }>('session.prompt', { sessionId, mode, content })
  }

  /** Cancel a session's active turn (pending inbox work resumes FIFO). */
  async cancel(sessionId: string): Promise<void> {
    await this.client.unary<{ accepted: true }>('session.cancel', { sessionId })
  }

  /** Read a durable image attachment back (M3) — host verifies the session log references the id. */
  async attachment(sessionId: string, attachmentId: string): Promise<{ data: string; mediaType: string; name?: string }> {
    const res = await this.client.unary<{ attachment: { mediaType: string; name?: string }; data: string }>(
      'session.attachment',
      { sessionId, attachmentId }
    )
    return { data: res.data, mediaType: res.attachment.mediaType, name: res.attachment.name }
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
