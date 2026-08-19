/**
 * Task 5.1 — compatibility smoke suite against the real pinned `dsh`.
 *
 * Runs the pinned Harness CLI against a real local process and verifies the
 * app-level contract: startup, ready URL, HTTP surface, restart, clean stop,
 * data preservation. Skipped when `dsh` is unavailable.
 *
 * The plan's chat/streaming/tool-call scenarios require the web UI/agent
 * loop; those are covered by the protocol fixture corpus (deterministic) and
 * must be extended here once the desktop Adapter streams real events.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HarnessProcess } from '../../apps/desktop/electron/runtime/harness-process'
import { runCompatibilityChecks } from '../../apps/desktop/electron/runtime/compatibility'

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

/** Isolated DSH_HOME: parallel dsh instances must never share the task-board
 *  single-instance ledger lock (~/.dsh/task-board). */
function isolatedEnv(): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'dshd-smoke-home-'))
  const realHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  linkIfExists(join(realHome, 'settings.yaml'), join(home, 'settings.yaml'))
  linkIfExists(join(realHome, '.credentials.yaml'), join(home, '.credentials.yaml'))
  linkIfExists(join(realHome, 'profiles', 'web'), join(home, 'profiles', 'web'))
  return { DSH_HOME: home }
}

describe.skipIf(!dshAvailable())('harness compatibility smoke', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-smoke-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('compatibility checks pass on this machine', async () => {
    const res = await runCompatibilityChecks({
      expectedDshVersion: '0.1.0',
      dataDir: dir
    })
    expect(res.ok, res.recovery).toBe(true)
  })

  it('startup: spawns dsh web, parses ready URL, serves HTTP', async () => {
    const hp = new HarnessProcess({ readyTimeoutMs: 60_000, env: isolatedEnv() })
    const info = await hp.start()
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const res = await fetch(info.url)
    expect(res.status).toBeLessThan(500)
    await hp.stop()
    expect(hp.getStatus().state).toBe('stopped')
  }, 90_000)

  it('restart: stops and starts again on a fresh port', async () => {
    const hp = new HarnessProcess({ readyTimeoutMs: 60_000, env: isolatedEnv() })
    const first = await hp.start()
    const second = await hp.restart()
    expect(second.port).toBeGreaterThan(0)
    expect(second.port).not.toBe(first.port)
    await hp.stop()
  }, 120_000)

  it('data preservation: session store survives runtime restart', async () => {
    const store = new (await import('@dshd/session-store')).SessionStore({
      path: join(dir, 'smoke.db'),
      runtimeVersion: '0.1.0-rc.6'
    })
    const conv = store.createConversation('smoke test')
    store.addMessage(conv.id, 'user', 'hello from smoke')
    store.close()

    // reopen = restart recovery
    const reopened = new (await import('@dshd/session-store')).SessionStore({ path: join(dir, 'smoke.db') })
    expect(reopened.getConversation(conv.id)?.title).toBe('smoke test')
    expect(reopened.listMessages(conv.id)[0].content).toBe('hello from smoke')
    reopened.close()
  })

  it('timeout: a missing executable fails fast with a clear error', async () => {
    const hp = new HarnessProcess({ dshBin: 'definitely-not-a-real-bin-xyz', readyTimeoutMs: 5_000 })
    await expect(hp.start()).rejects.toThrow()
    expect(hp.getStatus().state).toBe('error')
  })
})
