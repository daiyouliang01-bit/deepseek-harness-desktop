import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

describe.skipIf(!dshAvailable() || !live)('free-vision plugin (opt-in)', () => {
  let hp: HarnessProcess
  let adapter: SessionAdapter
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-fv-'))
    // spawn with the web profile (which has dsh-free-vision in bundles)
    hp = new HarnessProcess({ readyTimeoutMs: 60_000, topLevelArgs: ['--patch', PATCH], dshBin: process.env.DSHD_DSH_BIN ?? 'dsh' })
    const info = await hp.start()
    const store = new SessionStore({ path: join(dir, 'sessions.db') })
    adapter = new SessionAdapter({ client: new RpcClient({ baseUrl: info.url }), store })
  }, 120_000)
  afterAll(async () => {
    await hp?.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  it('agent calls image_understand to read a red image via the vision plugin', async () => {
    const { sessionId } = await adapter.create()
    const client = new RpcClient({ baseUrl: hp.getStatus().ready!.url })
    const texts: string[] = []
    const toolCalls: string[] = []
    const bridge = new StreamBridge({
      client,
      onEvents: (events) => {
        for (const e of events) {
          if (e.type === 'delta') texts.push(e.text)
          if (e.type === 'message' && e.role === 'assistant') texts.push(e.content)
          if (e.type === 'tool-call') toolCalls.push(e.name)
        }
      },
      batchMs: 10
    })
    bridge.setActiveSession(sessionId)
    const sp = bridge.start()
    await new Promise((r) => setTimeout(r, 500))

    const imgB64 = readFileSync('/tmp/red512.png').toString('base64')
    await client.unary('session.prompt', {
      sessionId,
      mode: 'steer',
      content: [
        { type: 'text', text: 'Use the image_understand tool on the attached image and tell me what color it is.' },
        { type: 'image', mediaType: 'image/png', data: imgB64, name: 'red.png' }
      ]
    })

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline && !toolCalls.includes('image_understand') && texts.join('').length < 10) {
      await new Promise((r) => setTimeout(r, 500))
    }
    // give it time to finish after the tool call
    await new Promise((r) => setTimeout(r, 10_000))
    bridge.stop()
    await sp

    console.log('TOOLCALLS:', JSON.stringify(toolCalls))
    console.log('TEXT:', JSON.stringify(texts.join('').slice(0, 300)))
    expect(toolCalls).toContain('image_understand')
  }, 240_000)
})
