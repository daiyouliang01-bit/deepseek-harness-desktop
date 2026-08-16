import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionStore } from '@dshd/session-store'
import type { RpcClient } from './rpc-client'
import { SessionAdapter } from './session-adapter'

describe('SessionAdapter (mock wire)', () => {
  let dir: string
  let store: SessionStore
  let adapter: SessionAdapter
  const calls: Array<{ method: string; payload: unknown }> = []
  const respond = vi.fn()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-sessadapter-'))
    store = new SessionStore({ path: join(dir, 'sessions.db') })
    const client = {
      unary: async (method: string, payload: unknown) => {
        calls.push({ method, payload })
        switch (method) {
          case 'session.list':
            return {
              items: [
                { sessionId: 's1', updatedAt: 1000, running: false, blank: false, title: 'Hello' },
                { sessionId: 's2', updatedAt: 900, running: true, blank: true }
              ]
            }
          case 'session.create':
            return { sessionId: 's3', agentPreset: 'cordis' }
          case 'session.history':
            return {
              events: [
                {
                  event: { type: 'assistant/chunk', seq: 1, time: 1, data: { chunk: { delta: 'hi' } } },
                  view: undefined
                },
                { event: { type: 'turn/end', seq: 2, time: 1, data: {} }, view: undefined }
              ],
              hasMore: false
            }
          case 'session.rename':
            return { title: 'Renamed', seq: 5 }
          case 'session.search':
            return { items: [{ sessionId: 's1', snippet: '…hello…' }], hasMore: false }
          default:
            throw new Error(`unexpected method ${method}`)
        }
      }
    } as unknown as RpcClient
    adapter = new SessionAdapter({ client, store })
    void respond
  })

  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
    calls.length = 0
  })

  it('lists remote sessions and upserts into the local cache', async () => {
    const items = await adapter.list()
    expect(items).toHaveLength(2)
    expect(calls[0]).toMatchObject({ method: 'session.list', payload: {} })
    const cached = store.listConversations()
    expect(cached.map((c) => c.id).sort()).toEqual(['s1', 's2'])
    expect(store.getConversation('s1')?.title).toBe('Hello')
  })

  it('creates a session with optional cwd and caches it', async () => {
    const { sessionId } = await adapter.create('/tmp/work')
    expect(sessionId).toBe('s3')
    expect(calls[0]).toMatchObject({ method: 'session.create', payload: { cwd: '/tmp/work' } })
    expect(store.getConversation('s3')).not.toBeNull()
  })

  it('maps history events to protocol events and tracks lastSeq/hasMore', async () => {
    const page = await adapter.history('s1')
    expect(page.events.map((e) => e.type)).toEqual(['delta', 'completion'])
    expect(page.lastSeq).toBe(2)
    expect(page.hasMore).toBe(false)
    expect(calls[0]).toMatchObject({ method: 'session.history', payload: { sessionId: 's1', maxMessages: 50 } })
  })

  it('renames and searches', async () => {
    await adapter.list() // populate the cache first (rename updates an existing row)
    await expect(adapter.rename('s1', 'New Title')).resolves.toBe('Renamed')
    expect(store.getConversation('s1')?.title).toBe('Renamed')
    const hits = await adapter.search('hello')
    expect(hits).toEqual([{ sessionId: 's1', snippet: '…hello…' }])
  })

  it('archives and unarchives locally (no official session.delete)', async () => {
    await adapter.list()
    adapter.archive('s1')
    expect(store.isArchived('s1')).toBe(true)
    expect(store.listConversations(100, false).map((c) => c.id)).not.toContain('s1')
    expect(store.listConversations(100, true).map((c) => c.id)).toContain('s1')
    adapter.unarchive('s1')
    expect(store.isArchived('s1')).toBe(false)
  })
})

describe('session-store schema v2', () => {
  it('migrates a v1 database by adding the archived column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshd-migrate-v2-'))
    const path = join(dir, 'v1.db')
    try {
      // simulate a v1 database
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
      const db = new DatabaseSync(path)
      db.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', project_id TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, runtime_version TEXT
        );
        INSERT INTO meta VALUES ('schema_version', '1');
      `)
      db.close()

      const store = new SessionStore({ path })
      expect(store.getSchemaVersion()).toBe(2)
      expect(store.isArchived('anything')).toBe(false) // column exists, no rows
      store.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
