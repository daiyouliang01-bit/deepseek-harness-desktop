import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionStore } from './repository'

describe('session store (file-backed)', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-store-'))
    path = join(dir, 'sessions.db')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates conversations and persists messages with runtime version', () => {
    const store = new SessionStore({ path, runtimeVersion: '0.1.0-rc.6' })
    const conv = store.createConversation('hello world')
    expect(conv.runtimeVersion).toBe('0.1.0-rc.6')

    store.addMessage(conv.id, 'user', 'Hi')
    store.addMessage(conv.id, 'assistant', 'Hello!')
    const msgs = store.listMessages(conv.id)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'Hi', seq: 0 })
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: 'Hello!', seq: 1 })
    store.close()
  })

  it('recovers state after reopen (restart recovery)', () => {
    const convId = (() => {
      const s = new SessionStore({ path })
      const c = s.createConversation('persist me')
      s.addMessage(c.id, 'user', 'will survive restart')
      s.close()
      return c.id
    })()

    const reopened = new SessionStore({ path })
    expect(reopened.getConversation(convId)?.title).toBe('persist me')
    expect(reopened.listMessages(convId)[0].content).toBe('will survive restart')
    reopened.close()
  })

  it('schema migration runs idempotently and stamps the version', () => {
    const s1 = new SessionStore({ path })
    expect(s1.getSchemaVersion()).toBe(1)
    s1.close()
    const s2 = new SessionStore({ path }) // reopen → migrate() again
    expect(s2.getSchemaVersion()).toBe(1)
    s2.close()
  })

  it('tool calls attach to messages and update status', () => {
    const store = new SessionStore({ path })
    const conv = store.createConversation()
    const msg = store.addMessage(conv.id, 'assistant', '')
    store.addToolCall(msg.id, 'c1', 'bash', { cmd: 'ls' })
    store.updateToolCall('c1', 'ok', 'file.txt')
    const calls = store.listToolCalls(msg.id)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ name: 'bash', status: 'ok' })
    expect(JSON.parse(calls[0].args)).toEqual({ cmd: 'ls' })
    store.close()
  })

  it('searches messages via FTS5 with snippets', () => {
    const store = new SessionStore({ path })
    const conv = store.createConversation('search me')
    store.addMessage(conv.id, 'user', 'the quick brown fox jumps')
    store.addMessage(conv.id, 'assistant', 'foxes are quick animals')
    const results = store.searchMessages('fox')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].content).toMatch(/fox/i)
    store.close()
  })

  it('export → fresh store import round-trips conversations and messages', () => {
    const store = new SessionStore({ path })
    const conv = store.createConversation('round trip')
    const m1 = store.addMessage(conv.id, 'user', 'hello')
    store.addToolCall(m1.id, 'tc1', 'read', { path: 'a.txt' })
    const exported = store.exportAll()
    store.close()

    const freshPath = join(dir, 'fresh.db')
    const fresh = new SessionStore({ path: freshPath })
    const counts = fresh.importAll(exported)
    expect(counts.conversations).toBe(1)
    expect(counts.messages).toBe(1)
    expect(fresh.listMessages(conv.id)[0].content).toBe('hello')
    expect(fresh.listToolCalls(m1.id)[0].name).toBe('read')
    fresh.close()
  })

  it('deletes conversations cascading to messages', () => {
    const store = new SessionStore({ path })
    const conv = store.createConversation()
    store.addMessage(conv.id, 'user', 'bye')
    store.deleteConversation(conv.id)
    expect(store.getConversation(conv.id)).toBeNull()
    expect(store.listMessages(conv.id)).toHaveLength(0)
    store.close()
  })

  it('stores settings and projects', () => {
    const store = new SessionStore({ path })
    store.setSetting('theme', 'dark')
    expect(store.getSetting('theme')).toBe('dark')
    const proj = store.createProject('demo', '/tmp/demo')
    expect(store.listProjects()).toHaveLength(1)
    expect(proj.rootPath).toBe('/tmp/demo')
    store.close()
  })
})

describe('session store (in-memory)', () => {
  it('works with :memory:', () => {
    const store = new SessionStore({ path: ':memory:' })
    const conv = store.createConversation()
    store.addMessage(conv.id, 'user', 'x')
    expect(store.listMessages(conv.id)).toHaveLength(1)
    store.close()
  })
})
