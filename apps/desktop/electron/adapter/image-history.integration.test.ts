import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionStore } from '@dshd/session-store'
import { intakeImages } from '../attachments/image-intake'
import { mapSessionEvent } from './event-mapper'
import { HarnessProcess } from '../runtime/harness-process'
import { RpcClient } from './rpc-client'
import { SessionAdapter } from './session-adapter'

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

describe.skipIf(!dshAvailable() || !live)('M3 image history read-back (opt-in)', () => {
  let hp: HarnessProcess
  let adapter: SessionAdapter
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-his-'))
    hp = new HarnessProcess({ readyTimeoutMs: 60_000, topLevelArgs: ['--patch', PATCH], dshBin: process.env.DSHD_DSH_BIN ?? 'dsh' })
    const info = await hp.start()
    const store = new SessionStore({ path: join(dir, 'sessions.db') })
    adapter = new SessionAdapter({ client: new RpcClient({ baseUrl: info.url }), store })
  }, 120_000)
  afterAll(async () => {
    await hp?.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  it('sent image appears in history with attachmentId and reads back via session.attachment', async () => {
    const { sessionId } = await adapter.create()

    // send with image (M1 path)
    const intake = await intakeImages([{ name: 'red.png', path: '/tmp/red512.png' }])
    expect(intake.ok).toBe(true)
    if (!intake.ok) return
    await adapter.promptWithImages(sessionId, 'look at this', intake.images.map((im) => ({ name: im.name, mediaType: im.mediaType, dataB64: im.dataB64 })))

    // wait a moment for the user/message event to land, then read history
    await new Promise((r) => setTimeout(r, 2_000))
    const page = await adapter.history(sessionId)

    // find a user/message event with an image block
    let foundAttachmentId: string | null = null
    for (const ev of page.events) {
      if (ev.type === 'message' && ev.role === 'user' && ev.images && ev.images.length > 0) {
        foundAttachmentId = ev.images[0].attachmentId
        break
      }
    }
    console.log('FOUND attachmentId:', foundAttachmentId)
    expect(foundAttachmentId).toBeTruthy()

    // read back
    const att = await adapter.attachment(sessionId, foundAttachmentId!)
    console.log('READBACK mediaType:', att.mediaType, 'data len:', att.data.length)
    expect(att.data.length).toBeGreaterThan(100)
    expect(att.mediaType).toBe('image/png')
  }, 120_000)
})
