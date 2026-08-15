import { describe, expect, it } from 'vitest'
import { HarnessProcess } from './harness-process'

/**
 * Integration test against the real `dsh` CLI (must be on PATH).
 * `dsh web --port 0` runs a plain HTTP server on 127.0.0.1 — no GUI needed.
 * Skipped when the `dsh` binary is unavailable.
 */

function dshAvailable(): boolean {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    execFileSync('dsh', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!dshAvailable())('HarnessProcess (real dsh)', () => {
  it('starts the real dsh web, parses the ready URL, and stops cleanly', async () => {
    const hp = new HarnessProcess({
      readyTimeoutMs: 60_000,
      onOutput: (stream, line) => console.log(`[dsh:${stream}] ${line}`)
    })
    const info = await hp.start()
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(info.port).toBeGreaterThan(0)
    expect(hp.getStatus().state).toBe('ready')

    // the server should answer HTTP
    const res = await fetch(info.url)
    expect(res.status).toBeLessThan(500)

    await hp.stop()
    expect(hp.getStatus().state).toBe('stopped')
  }, 90_000)

  it('restarts the runtime', async () => {
    const hp = new HarnessProcess({ readyTimeoutMs: 60_000 })
    const first = await hp.start()
    const second = await hp.restart()
    expect(second.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(second.port).toBeGreaterThan(0)
    expect(first.port).not.toBe(second.port) // --port 0 → new free port
    await hp.stop()
  }, 120_000)
})
