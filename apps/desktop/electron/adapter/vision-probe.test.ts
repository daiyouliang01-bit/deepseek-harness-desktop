import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
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

interface TestImage {
  b64: string
  mediaType: string
  name: string
}

// ----- minimal PNG encoder (no external fixtures) -----

function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

/** Solid-color 8-bit truecolor PNG, generated deterministically in-test. */
function solidPng(size: number, rgb: [number, number, number]): Buffer {
  const stride = 1 + size * 3 // filter byte + RGB triplet per pixel
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    const row = y * stride
    raw[row] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      raw[row + 1 + x * 3] = rgb[0]
      raw[row + 2 + x * 3] = rgb[1]
      raw[row + 3 + x * 3] = rgb[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * M0: color-fidelity probe — solid 512px PNGs (not 1x1). Built lazily inside
 * beforeAll: the old version read hand-made files from /tmp at MODULE LOAD,
 * which crashed collection on any machine without them — before describe's
 * skipIf could even opt the suite out.
 */
function buildImages(): Record<string, TestImage> {
  const make = (name: string, rgb: [number, number, number]): TestImage => ({
    b64: solidPng(512, rgb).toString('base64'),
    mediaType: 'image/png',
    name
  })
  return {
    red: make('red512.png', [229, 57, 53]),
    green: make('green512.png', [67, 160, 71]),
    blue: make('blue512.png', [30, 136, 229])
  }
}

describe.skipIf(!dshAvailable() || !live)('M0 vision color fidelity (opt-in)', () => {
  let hp: HarnessProcess
  let adapter: SessionAdapter
  let dir: string
  let IMAGES: Record<string, TestImage>

  beforeAll(async () => {
    IMAGES = buildImages()
    dir = mkdtempSync(join(tmpdir(), 'dshd-m0-'))
    hp = new HarnessProcess({ readyTimeoutMs: 60_000, topLevelArgs: ['--patch', PATCH], dshBin: process.env.DSHD_DSH_BIN ?? 'dsh' })
    const info = await hp.start()
    const store = new SessionStore({ path: join(dir, 'sessions.db') })
    adapter = new SessionAdapter({ client: new RpcClient({ baseUrl: info.url }), store })
  }, 120_000)

  afterAll(async () => {
    await hp?.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  async function askColor(sessionId: string, image: { b64: string; mediaType: string; name: string }): Promise<string> {
    const client = new RpcClient({ baseUrl: hp.getStatus().ready!.url })
    const texts: string[] = []
    const bridge = new StreamBridge({
      client,
      onEvents: (events) => {
        for (const e of events) {
          if (e.type === 'delta') texts.push(e.text)
          if (e.type === 'message' && e.role === 'assistant') texts.push(e.content)
        }
      },
      batchMs: 10
    })
    bridge.setActiveSession(sessionId)
    const streamPromise = bridge.start()
    await new Promise((r) => setTimeout(r, 500))

    await client.unary('session.prompt', {
      sessionId,
      mode: 'steer',
      content: [
        { type: 'text', text: 'What is the dominant color of this image? Answer with exactly one color word.' },
        { type: 'image', mediaType: image.mediaType, data: image.b64, name: image.name }
      ]
    })

    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && texts.join('').length < 3) {
      await new Promise((r) => setTimeout(r, 500))
    }
    bridge.stop()
    await streamPromise
    return texts.join('').toLowerCase()
  }

  it('model reads red/green/blue correctly (color fidelity)', async () => {
    const { sessionId } = await adapter.create()

    const results: Record<string, string> = {}
    for (const [color, img] of Object.entries(IMAGES)) {
      results[color] = await askColor(sessionId, img)
      console.log(`COLOR ${color} →`, JSON.stringify(results[color].slice(0, 120)))
    }

    expect(results.red).toMatch(/red/)
    expect(results.green).toMatch(/green/)
    expect(results.blue).toMatch(/blue/)
  }, 300_000)
})
