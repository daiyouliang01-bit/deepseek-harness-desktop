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

describe.skipIf(!dshAvailable() || !live)('vision capability detection (opt-in)', () => {
  let hp: HarnessProcess
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-vd-'))
    hp = new HarnessProcess({ readyTimeoutMs: 60_000, topLevelArgs: ['--patch', PATCH], dshBin: process.env.DSHD_DSH_BIN ?? 'dsh' })
    await hp.start()
  }, 120_000)
  afterAll(async () => {
    await hp?.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  async function ask(sessionId: string, text: string, image?: { b64: string; mediaType: string; name: string }): Promise<string> {
    const client = new RpcClient({ baseUrl: hp.getStatus().ready!.url })
    const texts: string[] = []
    const bridge = new StreamBridge({ client, onEvents: (ev) => { for (const e of ev) { if (e.type === 'delta') texts.push(e.text); if (e.type === 'message' && e.role === 'assistant') texts.push(e.content) } }, batchMs: 10 })
    bridge.setActiveSession(sessionId)
    const sp = bridge.start()
    await new Promise((r) => setTimeout(r, 500))
    const content: Array<Record<string, unknown>> = [{ type: 'text', text }]
    if (image) content.push({ type: 'image', mediaType: image.mediaType, data: image.b64, name: image.name })
    await client.unary('session.prompt', { sessionId, mode: 'steer', content })
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && texts.join('').length < 5) await new Promise((r) => setTimeout(r, 500))
    bridge.stop()
    await sp
    return texts.join('')
  }

  it('neutral prompt reveals whether the model truly sees pixels', async () => {
    const client = new RpcClient({ baseUrl: hp.getStatus().ready!.url })
    const { sessionId } = await client.unary<{ sessionId: string }>('session.create', {})
    const img = { b64: readFileSync('/tmp/red512.png').toString('base64'), mediaType: 'image/png', name: 'red.png' }
    const withImage = await ask(sessionId, 'Describe what this image contains. What color is it?', img)
    console.log('WITH-IMAGE:', JSON.stringify(withImage.slice(0, 300)))
    // baseline: same question, no image
    const noImage = await ask(sessionId, 'Describe what this image contains. What color is it?')
    console.log('NO-IMAGE:', JSON.stringify(noImage.slice(0, 200)))
    // true vision → with-image mentions red; baseline won't
    expect(withImage.toLowerCase()).toMatch(/red/)
  }, 300_000)
})
