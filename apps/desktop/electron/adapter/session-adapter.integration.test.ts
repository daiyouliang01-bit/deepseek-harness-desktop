import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionStore } from '@dshd/session-store'
import { HarnessProcess } from '../runtime/harness-process'
import { RpcClient } from './rpc-client'
import { SessionAdapter } from './session-adapter'

function dshAvailable(): boolean {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    execFileSync('dsh', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!dshAvailable())('SessionAdapter ↔ real dsh (M2)', () => {
  let hp: HarnessProcess
  let store: SessionStore
  let adapter: SessionAdapter
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-m2-'))
    hp = new HarnessProcess({ readyTimeoutMs: 60_000 })
    const info = await hp.start()
    store = new SessionStore({ path: join(dir, 'sessions.db') })
    adapter = new SessionAdapter({ client: new RpcClient({ baseUrl: info.url }), store })
  }, 120_000)

  afterAll(async () => {
    store?.close()
    await hp?.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  it('create → list round-trip with cache upsert', async () => {
    const { sessionId } = await adapter.create()
    expect(sessionId).toBeTruthy()
    const items = await adapter.list()
    expect(items.some((s) => s.sessionId === sessionId)).toBe(true)
    expect(store.getConversation(sessionId)).not.toBeNull()
  }, 60_000)

  it('rename returns the accepted title and updates the cache', async () => {
    const { sessionId } = await adapter.create()
    const title = await adapter.rename(sessionId, 'M2 integration test')
    expect(title).toBe('M2 integration test')
    expect(store.getConversation(sessionId)?.title).toBe('M2 integration test')
  }, 60_000)

  it('history returns mapped protocol events for a fresh session', async () => {
    const { sessionId } = await adapter.create()
    const page = await adapter.history(sessionId)
    expect(Array.isArray(page.events)).toBe(true)
    expect(page.hasMore).toBe(false)
    expect(page.lastSeq).toBeGreaterThanOrEqual(-1)
  }, 60_000)

  it('search finds nothing for a garbage query but works', async () => {
    const hits = await adapter.search('zzzz-no-such-content-zzzz')
    expect(Array.isArray(hits)).toBe(true)
  }, 60_000)

  it('archive is local-only and hides from the unarchived list', async () => {
    const { sessionId } = await adapter.create()
    await adapter.list() // cache the row
    adapter.archive(sessionId)
    expect(store.isArchived(sessionId)).toBe(true)
    expect(store.listConversations(100, false).map((c) => c.id)).not.toContain(sessionId)
  }, 60_000)

  it('respond endpoint is live: unknown rpcId → accepted:false not-pending', async () => {
    const client = new RpcClient({ baseUrl: hp.getStatus().ready!.url })
    const receipt = await client.respond({
      type: 'client-response',
      rpcId: 'no-such-rpc',
      result: { ok: true, value: { sessionId: 'x', approvalId: 'x', outcome: 'allowed-once' } }
    })
    expect(receipt.accepted).toBe(false)
    expect(receipt.reason).toBe('not-pending')
  }, 60_000)
})
