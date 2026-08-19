/** Task 3.3 — session store repository (CRUD, search, migration, import/export). */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DDL, SCHEMA_VERSION, SEED_META } from './schema'
import type { ConversationRow, MessageRow, ProjectRow, ToolCallRow } from './schema'

export interface SessionStoreOptions {
  /** Path to the SQLite file. Use ':memory:' for tests. */
  path: string
  /** Current app runtime version, recorded per conversation. */
  runtimeVersion?: string
}

export class SessionStore {
  private readonly db: DatabaseSync
  private readonly runtimeVersion?: string

  constructor(options: SessionStoreOptions) {
    // SQLite cannot create missing parent directories — ensure they exist
    // (e.g. userData/db on first run) or opening throws and the session list
    // silently fails.
    if (options.path !== ':memory:') {
      mkdirSync(dirname(options.path), { recursive: true })
    }
    this.db = new DatabaseSync(options.path)
    this.runtimeVersion = options.runtimeVersion
    this.migrate()
  }

  /** Apply schema + version metadata (idempotent) + stepwise migrations. */
  migrate(): void {
    this.db.exec(DDL)
    // Read the OLD version BEFORE stamping the new one (migrations run first).
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined
    const oldVersion = Number(row?.value ?? 0)

    if (oldVersion < 2) {
      // v1 → v2: add the conversations.archived flag (M2 session archiving).
      const cols = this.db.prepare(`PRAGMA table_info(conversations)`).all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'archived')) {
        this.db.exec(`ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`)
      }
    }

    this.db.exec(SEED_META)
    this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(SCHEMA_VERSION))
  }

  close(): void {
    this.db.close()
  }

  /** Current schema version stamped in the meta table. */
  getSchemaVersion(): number {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined
    return Number(row?.value ?? 0)
  }

  // --- conversations ---

  createConversation(title = ''): ConversationRow {
    const id = crypto.randomUUID()
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, runtime_version) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, title, now, now, this.runtimeVersion ?? null)
    return { id, title, projectId: null, createdAt: now, updatedAt: now, runtimeVersion: this.runtimeVersion ?? null }
  }

  /** Upsert a remote session summary into the local cache (M2). */
  upsertConversation(id: string, title: string, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, archived)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           updated_at = excluded.updated_at,
           archived = conversations.archived`
      )
      .run(id, title, updatedAt, updatedAt)
  }

  listConversations(limit = 100, includeArchived = false): ConversationRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversations ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY updated_at DESC LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>
    return rows.map(rowToConversation)
  }

  /** Archived-only conversations, newest first (for the settings page). */
  listArchived(): ConversationRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM conversations WHERE archived = 1 ORDER BY updated_at DESC`)
      .all() as Array<Record<string, unknown>>
    return rows.map(rowToConversation)
  }

  setArchived(id: string, archived: boolean): void {
    this.db.prepare(`UPDATE conversations SET archived = ? WHERE id = ?`).run(archived ? 1 : 0, id)
  }

  isArchived(id: string): boolean {
    const row = this.db.prepare(`SELECT archived FROM conversations WHERE id = ?`).get(id) as { archived: number } | undefined
    return row?.archived === 1
  }

  getConversation(id: string): ConversationRow | null {
    const row = this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    return row ? rowToConversation(row) : null
  }

  renameConversation(id: string, title: string): void {
    this.db.prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`).run(title, Date.now(), id)
  }

  deleteConversation(id: string): void {
    this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id)
  }

  // --- messages ---

  addMessage(conversationId: string, role: MessageRow['role'], content: string): MessageRow {
    const id = crypto.randomUUID()
    const seq = (this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?`).get(conversationId) as { n: number }).n
    const now = Date.now()
    this.db
      .prepare(`INSERT INTO messages (id, conversation_id, role, content, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, conversationId, role, content, seq, now)
    this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId)
    return { id, conversationId, role, content, seq, createdAt: now }
  }

  listMessages(conversationId: string): MessageRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC`)
      .all(conversationId) as Array<Record<string, unknown>>
    return rows.map(rowToMessage)
  }

  // --- tool calls ---

  addToolCall(messageId: string, callId: string, name: string, args: unknown): void {
    this.db
      .prepare(`INSERT INTO tool_calls (call_id, message_id, name, args) VALUES (?, ?, ?, ?)`)
      .run(callId, messageId, name, JSON.stringify(args ?? {}))
  }

  updateToolCall(callId: string, status: ToolCallRow['status'], output?: unknown): void {
    this.db
      .prepare(`UPDATE tool_calls SET status = ?, output = ? WHERE call_id = ?`)
      .run(status, output === undefined ? null : JSON.stringify(output), callId)
  }

  listToolCalls(messageId: string): ToolCallRow[] {
    const rows = this.db.prepare(`SELECT * FROM tool_calls WHERE message_id = ?`).all(messageId) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      callId: String(r.call_id),
      messageId: String(r.message_id),
      name: String(r.name),
      args: String(r.args),
      status: r.status as ToolCallRow['status'],
      output: r.output === null ? null : String(r.output)
    }))
  }

  // --- projects ---

  createProject(name: string, rootPath: string): ProjectRow {
    const id = crypto.randomUUID()
    const now = Date.now()
    this.db.prepare(`INSERT INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)`).run(id, name, rootPath, now)
    return { id, name, rootPath, createdAt: now }
  }

  listProjects(): ProjectRow[] {
    const rows = this.db.prepare(`SELECT * FROM projects ORDER BY created_at ASC`).all() as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      rootPath: String(r.root_path),
      createdAt: Number(r.created_at)
    }))
  }

  // --- settings ---

  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, value)
  }

  // --- search (FTS5) ---

  searchMessages(query: string, limit = 20): Array<{ messageId: string; conversationId: string; content: string; snippet: string }> {
    const rows = this.db
      .prepare(
        `SELECT m.id AS messageId, m.conversation_id AS conversationId, m.content AS content,
                snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         WHERE messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(query, limit) as Array<{ messageId: string; conversationId: string; content: string; snippet: string }>
    return rows
  }

  // --- import / export ---

  exportAll(): string {
    const conversations = this.listConversations(10_000)
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      conversations: conversations.map((c) => ({
        ...c,
        messages: this.listMessages(c.id).map((m) => ({ ...m, toolCalls: this.listToolCalls(m.id) }))
      }))
    }
    return JSON.stringify(payload, null, 2)
  }

  importAll(json: string): { conversations: number; messages: number } {
    const payload = JSON.parse(json) as {
      conversations: Array<{
        id: string
        title: string
        createdAt: number
        updatedAt: number
        runtimeVersion?: string | null
        messages: Array<{
          id: string
          role: MessageRow['role']
          content: string
          seq: number
          createdAt: number
          toolCalls?: Array<{ callId: string; name: string; args: string; status: ToolCallRow['status']; output?: string | null }>
        }>
      }>
    }
    let messageCount = 0
    for (const c of payload.conversations) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO conversations (id, title, created_at, updated_at, runtime_version) VALUES (?, ?, ?, ?, ?)`
        )
        .run(c.id, c.title, c.createdAt, c.updatedAt, c.runtimeVersion ?? null)
      for (const m of c.messages) {
        this.db
          .prepare(`INSERT OR REPLACE INTO messages (id, conversation_id, role, content, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(m.id, c.id, m.role, m.content, m.seq, m.createdAt)
        messageCount++
        for (const tc of m.toolCalls ?? []) {
          this.db
            .prepare(`INSERT OR REPLACE INTO tool_calls (call_id, message_id, name, args, status, output) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(tc.callId, m.id, tc.name, tc.args, tc.status, tc.output ?? null)
        }
      }
    }
    return { conversations: payload.conversations.length, messages: messageCount }
  }
}

function rowToConversation(r: Record<string, unknown>): ConversationRow {
  return {
    id: String(r.id),
    title: String(r.title),
    projectId: r.project_id === null ? null : String(r.project_id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    runtimeVersion: r.runtime_version === null ? null : String(r.runtime_version),
    archived: r.archived === 1
  }
}

function rowToMessage(r: Record<string, unknown>): MessageRow {
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    role: r.role as MessageRow['role'],
    content: String(r.content),
    seq: Number(r.seq),
    createdAt: Number(r.created_at)
  }
}
