import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionStore } from '@dshd/session-store'
import { intakeImages } from '../attachments/image-intake'
import { HarnessProcess } from '../runtime/harness-process'
import { RpcClient } from './rpc-client'
import { SessionAdapter } from './session-adapter'
import { StreamBridge } from './stream-bridge'

function dshAvailable(): boolean {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    // Honor the same binary override the spawn path uses; a bare 'dsh' on
    // PATH is only one of the ways these suites can run.
    const bin = process.env.DSHD_DSH_BIN ?? 'dsh'
    execFileSync(bin, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const live = Boolean(process.env.DSHD_LIVE_PROMPT)
const PATCH = join(__dirname, '../../resources/desktop-tools.patch.yml')

describe.skipIf(!dshAvailable() || !live)('M1+M2 image send end-to-end (opt-in)', () => {
  let hp: HarnessProcess
  let adapter: SessionAdapter
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-img-'))
    hp = new HarnessProcess({ readyTimeoutMs: 60_000, topLevelArgs: ['--patch', PATCH], dshBin: process.env.DSHD_DSH_BIN ?? 'dsh' })
    const info = await hp.start()
    const store = new SessionStore({ path: join(dir, 'sessions.db') })
    adapter = new SessionAdapter({ client: new RpcClient({ baseUrl: info.url }), store })
  }, 120_000)
  afterAll(async () => {
    await hp?.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  it('intake → prompt with image → modlens reads color → streamed answer', async () => {
    const { sessionId } = await adapter.create()

    // M1: preflight (as the main process would for dropped files)
    const intake = await intakeImages([{ name: 'red.png', path: '/tmp/red512.png' }])
    expect(intake.ok).toBe(true)
    if (!intake.ok) return
    expect(intake.images).toHaveLength(1)

    // stream
    const client = new RpcClient({ baseUrl: hp.getStatus().ready!.url })
    const texts: string[] = []
    const tools: string[] = []
    const bridge = new StreamBridge({
      client,
      onEvents: (ev) => {
        for (const e of ev) {
          if (e.type === 'delta') texts.push(e.text)
          if (e.type === 'message' && e.role === 'assistant') texts.push(e.content)
          if (e.type === 'tool-call') tools.push(e.name)
        }
      },
      batchMs: 10
    })
    bridge.setActiveSession(sessionId)
    const sp = bridge.start()
    await new Promise((r) => setTimeout(r, 500))

    // M1: promptWithImages (as agent:send would)
    await adapter.promptWithImages(
      sessionId,
      'What color is this image? One word.',
      intake.images.map((im) => ({ name: im.name, mediaType: im.mediaType, dataB64: im.dataB64 }))
    )

    const deadline = Date.now() + 120_000
    let answerLen = 0
    while (Date.now() < deadline) {
      const joined = texts.join('')
      if (joined.length > 0 && joined.length === answerLen && joined.length > 10) break // stalled
      answerLen = joined.length
      await new Promise((r) => setTimeout(r, 500))
    }
    bridge.stop()
    await sp

    const answer = texts.join('')
    console.log('TOOLS:', JSON.stringify(tools))
    console.log('ANSWER:', JSON.stringify(answer.slice(0, 200)))
    expect(answer.toLowerCase()).toMatch(/red/)
  }, 240_000)
})
