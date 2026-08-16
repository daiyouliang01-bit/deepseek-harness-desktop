import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

// 1x1 red PNG (base64) — minimal valid image
const RED_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe.skipIf(!dshAvailable() || !live)('vision capability probe (opt-in)', () => {
  let hp: HarnessProcess
  let adapter: SessionAdapter
  let bridge: StreamBridge
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-vision-'))
    hp = new HarnessProcess({ readyTimeoutMs: 60_000, topLevelArgs: ['--patch', PATCH], dshBin: process.env.DSHD_DSH_BIN ?? 'dsh' })
    const info = await hp.start()
    const store = new SessionStore({ path: join(dir, 'sessions.db') })
    adapter = new SessionAdapter({ client: new RpcClient({ baseUrl: info.url }), store })
  }, 120_000)

  afterAll(async () => {
    bridge?.stop()
    await hp?.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  it('model can see image content (color of a 1x1 red png)', async () => {
    const { sessionId } = await adapter.create()
    const client = new RpcClient({ baseUrl: hp.getStatus().ready!.url })
    const collected: string[] = []
    const texts: string[] = []
    bridge = new StreamBridge({
      client,
      onEvents: (events) => {
        for (const e of events) {
          collected.push(e.type)
          if (e.type === 'delta') texts.push(e.text)
          if (e.type === 'message' && e.role === 'assistant') texts.push(e.content)
        }
      },
      batchMs: 10
    })
    bridge.setActiveSession(sessionId)
    const streamPromise = bridge.start()
    await new Promise((r) => setTimeout(r, 500))

    // send text + image part
    const rpc = new RpcClient({ baseUrl: hp.getStatus().ready!.url })
    await rpc.unary('session.prompt', {
      sessionId,
      mode: 'steer',
      content: [
        { type: 'text', text: 'What color is this image? Answer with one word.' },
        { type: 'image', mediaType: 'image/png', data: RED_PNG_B64, name: 'dot.png' }
      ]
    })

    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && !collected.includes('completion')) {
      await new Promise((r) => setTimeout(r, 500))
    }
    bridge.stop()
    await streamPromise

    const answer = texts.join('')
    console.log('ANSWER:', JSON.stringify(answer.slice(0, 200)))
    expect(collected).toContain('completion')
    expect(collected).not.toContain('error')
    // model should say red (case-insensitive)
    expect(answer.toLowerCase()).toMatch(/red/)
  }, 150_000)
})
