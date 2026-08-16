import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionStore } from '@dshd/session-store'
import { HarnessProcess } from '../runtime/harness-process'
import { RpcClient } from './rpc-client'
import { SessionAdapter } from './session-adapter'
import { StreamBridge } from './stream-bridge'

function dshAvailable(): boolean {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    execFileSync('dsh', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * M3 live streaming test — OPT-IN via DSHD_LIVE_PROMPT=1 because it sends a
 * real prompt (consumes tokens; needs a configured API key on the machine).
 * Verifies the full loop: prompt → mux stream → mapped protocol events.
 */
const live = Boolean(process.env.DSHD_LIVE_PROMPT)

describe.skipIf(!dshAvailable() || !live)('M3 live streaming (opt-in)', () => {
  let hp: HarnessProcess
  let adapter: SessionAdapter
  let bridge: StreamBridge
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-m3-'))
    hp = new HarnessProcess({ readyTimeoutMs: 60_000 })
    const info = await hp.start()
    const store = new SessionStore({ path: join(dir, 'sessions.db') })
    adapter = new SessionAdapter({ client: new RpcClient({ baseUrl: info.url }), store })
  }, 120_000)

  afterAll(async () => {
    bridge?.stop()
    await hp?.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  it('prompt → live mux events → mapped protocol events', async () => {
    const { sessionId } = await adapter.create()
    expect(sessionId).toBeTruthy()

    const client = new RpcClient({ baseUrl: hp.getStatus().ready!.url })
    const collected: string[] = []
    bridge = new StreamBridge({
      client,
      onEvents: (events) => {
        for (const e of events) collected.push(e.type)
      },
      batchMs: 10
    })
    bridge.setActiveSession(sessionId)
    const streamPromise = bridge.start()

    // send the prompt after the stream is up
    await new Promise((r) => setTimeout(r, 500))
    await adapter.prompt(sessionId, 'Reply with the single word: pong', 'steer')

    // wait for a completion or a 60s timeout
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline && !collected.includes('completion')) {
      await new Promise((r) => setTimeout(r, 500))
    }

    bridge.stop()
    await streamPromise

    expect(collected).toContain('completion')
    expect(collected.some((t) => t === 'delta' || t === 'message')).toBe(true)
    expect(collected.some((t) => t === 'error')).toBe(false)
  }, 120_000)
})
