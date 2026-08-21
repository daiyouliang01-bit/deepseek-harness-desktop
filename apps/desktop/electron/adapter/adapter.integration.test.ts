import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { HarnessProcess } from '../runtime/harness-process'
import { RpcClient } from './rpc-client'

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

function linkIfExists(from: string, to: string): void {
  if (!existsSync(from)) return
  mkdirSync(dirname(to), { recursive: true })
  try {
    symlinkSync(from, to)
  } catch {
    /* already linked */
  }
}

/**
 * Isolate this dsh instance behind its own DSH_HOME so parallel tests never
 * share the task-board single-instance ledger lock (~/.dsh/task-board).
 */
function isolatedEnv(): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'dshd-adapter-home-'))
  const realHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  linkIfExists(join(realHome, 'settings.yaml'), join(home, 'settings.yaml'))
  linkIfExists(join(realHome, '.credentials.yaml'), join(home, '.credentials.yaml'))
  linkIfExists(join(realHome, 'profiles', 'web'), join(home, 'profiles', 'web'))
  return { DSH_HOME: home }
}

const isolated = isolatedEnv()
afterAll(() => {})

/**
 * M1 live contract test: spawn the real dsh, open the mux SSE stream over
 * plain fetch, and assert the official wire contract (server-request
 * envelopes carrying frames). The loopback Host is trusted by the
 * browser-trust fence, so no --trusted-host is needed.
 */
describe.skipIf(!dshAvailable())('adapter ↔ real dsh (M1 contract)', () => {
  it('session.list unary works over the wire', async () => {
    const hp = new HarnessProcess({ readyTimeoutMs: 60_000, env: isolated })
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
    const hp = new HarnessProcess({ readyTimeoutMs: 60_000, env: isolated })
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
