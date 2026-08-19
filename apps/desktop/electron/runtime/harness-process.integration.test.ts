import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

function linkIfExists(from: string, to: string): void {
  if (!existsSync(from)) return
  mkdirSync(dirname(to), { recursive: true })
  try {
    symlinkSync(from, to)
  } catch {
    /* already linked */
  }
}

/** Own DSH_HOME per test: parallel dsh instances never share the
 *  task-board single-instance ledger lock (~/.dsh/task-board). */
function isolatedEnv(): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'dshd-hp-home-'))
  const realHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  linkIfExists(join(realHome, 'settings.yaml'), join(home, 'settings.yaml'))
  linkIfExists(join(realHome, '.credentials.yaml'), join(home, '.credentials.yaml'))
  linkIfExists(join(realHome, 'profiles', 'web'), join(home, 'profiles', 'web'))
  return { DSH_HOME: home }
}

describe.skipIf(!dshAvailable())('HarnessProcess (real dsh)', () => {
  it('starts the real dsh web, parses the ready URL, and stops cleanly', async () => {
    const hp = new HarnessProcess({
      readyTimeoutMs: 60_000,
      env: isolatedEnv(),
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
    const hp = new HarnessProcess({ readyTimeoutMs: 60_000, env: isolatedEnv() })
    const first = await hp.start()
    const second = await hp.restart()
    expect(second.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(second.port).toBeGreaterThan(0)
    expect(first.port).not.toBe(second.port) // --port 0 → new free port
    await hp.stop()
  }, 120_000)
})
