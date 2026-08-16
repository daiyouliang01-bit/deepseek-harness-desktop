import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionStore } from '@dshd/session-store'
import { HarnessProcess } from '../runtime/harness-process'
import { RpcClient } from './rpc-client'
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

describe.skipIf(!dshAvailable() || !live)('modlens vision via qwen (opt-in)', () => {
  let hp: HarnessProcess
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-ml-'))
    hp = new HarnessProcess({ readyTimeoutMs: 60_000, topLevelArgs: ['--patch', PATCH], dshBin: process.env.DSHD_DSH_BIN ?? 'dsh' })
    await hp.start()
  }, 120_000)
  afterAll(async () => {
    await hp?.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  async function askColor(sessionId: string, color: string): Promise<string> {
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

    const imgB64 = readFileSync(`/tmp/${color}512.png`).toString('base64')
    await client.unary('session.prompt', {
      sessionId,
      mode: 'steer',
      content: [
        { type: 'text', text: 'What color is the attached image? Answer with one color word.' },
        { type: 'image', mediaType: 'image/png', data: imgB64, name: `${color}.png` }
      ]
    })

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline && texts.join('').length < 40) await new Promise((r) => setTimeout(r, 500))
    bridge.stop()
    await sp
    return `${tools.join(',')}|${texts.join('').toLowerCase()}`
  }

  it('model reads red/green/blue through modlens/qwen', async () => {
    const client = new RpcClient({ baseUrl: hp.getStatus().ready!.url })
    const results: Record<string, string> = {}
    for (const c of ['red', 'green', 'blue']) {
      const { sessionId } = await client.unary<{ sessionId: string }>('session.create', {})
      const r = await askColor(sessionId, c)
      results[c] = r
      console.log(`RESULT ${c} →`, JSON.stringify(r.slice(0, 160)))
    }
    for (const c of ['red', 'green', 'blue']) {
      expect(results[c].toLowerCase()).toMatch(new RegExp(c))
    }
  }, 400_000)
})
