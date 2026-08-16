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

const live = Boolean(process.env.DSHD_LIVE_PROMPT)
const PATCH = join(__dirname, '../../resources/desktop-tools.patch.yml')

describe.skipIf(!dshAvailable() || !live)('desktop tools live (opt-in)', () => {
  let hp: HarnessProcess
  let adapter: SessionAdapter
  let bridge: StreamBridge
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-tools-'))
    // spawn the web profile WITH the desktop tools patch
    hp = new HarnessProcess({
      readyTimeoutMs: 60_000,
      topLevelArgs: ['--patch', PATCH],
      dshBin: process.env.DSHD_DSH_BIN ?? 'dsh'
    })
    const info = await hp.start()
    const store = new SessionStore({ path: join(dir, 'sessions.db') })
    adapter = new SessionAdapter({ client: new RpcClient({ baseUrl: info.url }), store })
  }, 120_000)

  afterAll(async () => {
    bridge?.stop()
    await hp?.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  it('model can call tools (bash) in the patched profile', async () => {
    const { sessionId } = await adapter.create()
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
    await new Promise((r) => setTimeout(r, 500))

    await adapter.prompt(sessionId, 'Use the bash tool to run `echo tool-works` and tell me its output.', 'steer')

    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && !collected.includes('completion')) {
      await new Promise((r) => setTimeout(r, 500))
    }
    bridge.stop()
    await streamPromise

    expect(collected).toContain('completion')
    expect(collected).toContain('tool-call')
    expect(collected).toContain('tool-result')
  }, 150_000)
})
