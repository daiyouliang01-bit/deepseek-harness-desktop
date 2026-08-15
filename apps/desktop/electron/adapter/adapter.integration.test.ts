import { describe, expect, it } from 'vitest'
import { HarnessProcess } from '../runtime/harness-process'
import { RpcClient } from './rpc-client'

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
 * M1 live contract test: spawn the real dsh, open the mux SSE stream over
 * plain fetch, and assert the official wire contract (server-request
 * envelopes carrying frames). The loopback Host is trusted by the
 * browser-trust fence, so no --trusted-host is needed.
 */
describe.skipIf(!dshAvailable())('adapter ↔ real dsh (M1 contract)', () => {
  it('session.list unary works over the wire', async () => {
    const hp = new HarnessProcess({ readyTimeoutMs: 60_000 })
    try {
      const info = await hp.start()
      const client = new RpcClient({ baseUrl: info.url })
      const result = await client.unary<{ items: unknown[] }>('session.list', {})
      expect(Array.isArray(result.items)).toBe(true)
    } finally {
      await hp.stop()
    }
  }, 90_000)

  it('mux WebSocket stream yields subscribed baseline after session.create', async () => {
    const hp = new HarnessProcess({ readyTimeoutMs: 60_000 })
    try {
      const info = await hp.start()
      const client = new RpcClient({ baseUrl: info.url })

      // The mux stream only emits subscribed frames for attached sessions —
      // create one first so the baseline frame arrives.
      const created = await client.unary<{ sessionId: string }>('session.create', {})
      expect(created.sessionId).toBeTruthy()

      const controller = new AbortController()
      const got: string[] = []
      const timer = setTimeout(() => controller.abort(), 10_000)
      try {
        for await (const frame of client.openSocketStream('/api/events.mux', controller.signal)) {
          got.push(frame.payload.type)
          if (got.length >= 1) break
        }
      } finally {
        clearTimeout(timer)
      }
      expect(got).toContain('session/subscribed')
    } finally {
      await hp.stop()
    }
  }, 90_000)
})
