/**
 * Integration test (R12): reap a REAL child process acting as an orphan,
 * using the same triple-check + process-group kill path as production.
 *
 * Uses a plain `node -e "setInterval..."` fixture whose command line carries
 * the app signature substring, so the test is hermetic (no real dsh needed)
 * and safe (kills only processes this test spawned).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reapLedgerOrphan, probeProcess } from './orphan-reaper'
import { saveLedger } from './process-ledger'

const FIXTURE = 'node -e "setInterval(()=>{},1000)" --patch /app/resources/desktop-tools.patch.yml --profile web'

/** A process is "dead" when it is gone OR a zombie (R20 — zombie = dead). */
function isDead(pid: number): boolean {
  const p = probeProcess(pid)
  return p === null || p.state.includes('Z')
}

describe('orphan-reaper integration (real process)', () => {
  let dir: string
  let childPid = 0

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reaper-int-'))
  })

  afterEach(async () => {
    if (childPid) {
      try {
        process.kill(childPid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('spawns a fixture child, records it in the ledger, then reaps it', async () => {
    // 1. spawn the "orphan" with the app signature in its argv
    //    (`--` separates node's -e script from the script's own args)
    //    NB: use process.execPath — vitest's forks pool strips PATH, so a bare
    //    'node' may not resolve (or resolve to a different binary).
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', '--', '--patch', '/app/resources/desktop-tools.patch.yml', '--profile', 'web'], {
      detached: true, // own process group, like the real spawn (R3)
      stdio: 'ignore'
    })
    childPid = child.pid ?? 0
    expect(childPid).toBeGreaterThan(0)
    const startedAt = Date.now() - 2_000 // pretend it was spawned 2s ago

    // 2. write the ledger exactly as the app would after a crash
    saveLedger(dir, {
      version: 2,
      spawned: { pid: childPid, startedAt, port: null, readyUrl: null, dshVersion: null, adopted: false },
      lastExit: { kind: 'crash', at: Date.now() }
    })

    // 3. triple check passes against the REAL process table
    const probe = probeProcess(childPid)
    expect(probe).not.toBeNull()
    expect(probe?.command).toContain('desktop-tools.patch.yml')

    // 4. reap it like the app does at startup
    const result = await reapLedgerOrphan({
      ledgerDir: dir,
      appSignature: 'desktop-tools.patch.yml',
      termGraceMs: 1_000
    })
    expect(result.reaped).toContain(childPid)

    // 5. it is really dead (gone or zombie — R20), and the ledger is cleared
    expect(isDead(childPid)).toBe(true)
    const { loadLedger } = await import('./process-ledger')
    expect(loadLedger(dir).spawned).toBeNull()
    childPid = 0
  })

  it('does NOT kill a fixture child whose start time does not match the ledger (PID reuse)', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', '--', '--patch', '/app/resources/desktop-tools.patch.yml', '--profile', 'web'], {
      detached: true,
      stdio: 'ignore'
    })
    childPid = child.pid ?? 0
    // ledger claims it started an hour ago — mismatch with the real start time
    saveLedger(dir, {
      version: 2,
      spawned: { pid: childPid, startedAt: Date.now() - 3_600_000, port: null, readyUrl: null, dshVersion: null, adopted: false },
      lastExit: { kind: 'crash', at: Date.now() }
    })
    const result = await reapLedgerOrphan({
      ledgerDir: dir,
      appSignature: 'desktop-tools.patch.yml',
      termGraceMs: 1_000
    })
    expect(result.reaped).toHaveLength(0)
    expect(result.dropped).toContain(childPid)
    // fixture is still alive (we must not kill unrelated processes, S4)
    expect(isDead(childPid)).toBe(false)
  })
})
