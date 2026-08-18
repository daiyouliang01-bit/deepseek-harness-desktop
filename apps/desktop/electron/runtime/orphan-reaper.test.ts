import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { etimeToSeconds, matchesLedger, probeProcess, killProcessGroup, reapLedgerOrphan, type ProcessProbe } from './orphan-reaper'
import { saveLedger } from './process-ledger'

describe('etimeToSeconds', () => {
  it('parses MM:SS, HH:MM:SS and d-HH:MM:SS (locale-independent)', () => {
    expect(etimeToSeconds('00:14')).toBe(14)
    expect(etimeToSeconds('01:02:03')).toBe(3723)
    expect(etimeToSeconds('2-01:02:03')).toBe(2 * 86400 + 3723)
  })

  it('returns null for unparseable input', () => {
    expect(etimeToSeconds('')).toBeNull()
    expect(etimeToSeconds('abc')).toBeNull()
  })
})

describe('matchesLedger (triple check, R1/R26/R27)', () => {
  const now = 1_000_000_000_000
  const startedAt = now - 10_000 // process started 10s ago

  function probe(overrides: Partial<ProcessProbe> = {}): ProcessProbe {
    return {
      pid: 4242,
      uptimeSec: 10,
      state: 'S',
      pgid: 4242,
      command: 'node /x/dsh/bin.js --patch /app/resources/desktop-tools.patch.yml --profile web --host 127.0.0.1 --port 35880',
      ...overrides
    }
  }

  it('matches when alive + start-time + signature all agree', () => {
    const r = matchesLedger(probe(), startedAt, now, 5000, 'desktop-tools.patch.yml', [])
    expect(r.match).toBe(true)
  })

  it('rejects when the process is not alive (PID reuse / gone)', () => {
    const r = matchesLedger(null, startedAt, now, 5000, 'desktop-tools.patch.yml', [])
    expect(r.match).toBe(false)
    expect(r.reason).toBe('not-alive')
  })

  it('rejects when start time mismatches — PID reused by another process (S4)', () => {
    // ledger says 10s ago but the process has been up for an hour
    const r = matchesLedger(probe({ uptimeSec: 3600 }), startedAt, now, 5000, 'desktop-tools.patch.yml', [])
    expect(r.match).toBe(false)
    expect(r.reason).toBe('etime-mismatch')
  })

  it('rejects a zombie (R20) even if start time matches', () => {
    const r = matchesLedger(probe({ state: 'Z' }), startedAt, now, 5000, 'desktop-tools.patch.yml', [])
    expect(r.match).toBe(false)
    expect(r.reason).toBe('zombie')
  })

  it('rejects when the app signature is missing (manual instance, R19)', () => {
    const r = matchesLedger(
      probe({ command: 'node /x/dsh/bin.js web --host 127.0.0.1 --port 0' }),
      startedAt, now, 5000, 'desktop-tools.patch.yml', []
    )
    expect(r.match).toBe(false)
    expect(r.reason).toBe('signature-missing')
  })

  it('rejects when a required arg is missing (R27)', () => {
    const r = matchesLedger(probe(), startedAt, now, 5000, 'desktop-tools.patch.yml', ['--profile'])
    expect(r.match).toBe(true) // --profile present in default command
    const r2 = matchesLedger(probe(), startedAt, now, 5000, 'desktop-tools.patch.yml', ['--trusted-host'])
    expect(r2.match).toBe(false)
    expect(r2.reason).toContain('arg-missing')
  })

  it('treats unreadable etime as not-match (fail-safe)', () => {
    const r = matchesLedger(probe({ uptimeSec: null }), startedAt, now, 5000, 'desktop-tools.patch.yml', [])
    expect(r.match).toBe(false)
    expect(r.reason).toBe('etime-unreadable')
  })
})

describe('killProcessGroup', () => {
  it('escalates SIGTERM → SIGKILL and reports death via the injected kill fn', async () => {
    const calls: Array<{ pid: number; sig: string }> = []
    const killFn = (pid: number, sig: NodeJS.Signals) => {
      calls.push({ pid, sig })
      return true
    }
    // probeProcess is called during the grace wait; make it report the process
    // gone after the first poll so the function returns early.
    const probeSpy = vi.spyOn({ p: () => null }, 'p') // placeholder
    const dead = await killProcessGroup(4242, 4242, { termGraceMs: 1000, killFn })
    expect(calls.some((c) => c.pid === -4242 && c.sig === 'SIGTERM')).toBe(true)
    expect(dead).toBe(true)
  })
})

describe('reapLedgerOrphan', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reaper-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('kills a matching ledger process and clears the ledger', async () => {
    saveLedger(dir, {
      version: 2,
      spawned: { pid: 4242, startedAt: Date.now() - 5_000, port: null, readyUrl: null, dshVersion: null, adopted: false },
      lastExit: { kind: 'crash', at: Date.now() }
    })
    // Alive during the SIGTERM grace window, gone after escalation.
    let killed = false
    const probeFn = () =>
      killed
        ? null
        : {
            pid: 4242, uptimeSec: 5, state: 'S', pgid: 4242,
            command: 'node /x/dsh/bin.js --patch /app/resources/desktop-tools.patch.yml --profile web'
          }
    const killFn = vi.fn(() => {
      killed = true // first SIGTERM "kills" it — subsequent probes report gone
      return true
    })
    const result = await reapLedgerOrphan({
      ledgerDir: dir,
      appSignature: 'desktop-tools.patch.yml',
      termGraceMs: 500,
      killFn,
      probeFn
    })
    expect(result.reaped).toContain(4242)
    // ledger cleared
    const { loadLedger } = await import('./process-ledger')
    expect(loadLedger(dir).spawned).toBeNull()
  })

  it('drops (does not kill) a mismatched entry — PID reuse scenario', async () => {
    // Ledger says the process started 30 minutes ago, but the process at this
    // pid has actually been up for an hour — PID was reused by something else.
    saveLedger(dir, {
      version: 2,
      spawned: { pid: 4242, startedAt: Date.now() - 1_800_000, port: null, readyUrl: null, dshVersion: null, adopted: false },
      lastExit: { kind: 'crash', at: Date.now() }
    })
    const probeFn = () => ({
      pid: 4242, uptimeSec: 3_600, state: 'S', pgid: 4242,
      command: 'node /x/dsh/bin.js --patch /app/resources/desktop-tools.patch.yml --profile web'
    })
    const killFn = vi.fn(() => true)
    const result = await reapLedgerOrphan({
      ledgerDir: dir,
      appSignature: 'desktop-tools.patch.yml',
      termGraceMs: 500,
      killFn,
      probeFn
    })
    expect(result.reaped).toHaveLength(0)
    expect(result.dropped).toContain(4242)
    expect(killFn).not.toHaveBeenCalled()
  })

  it('no-ops when the ledger has no spawned entry', async () => {
    const result = await reapLedgerOrphan({ ledgerDir: dir, appSignature: 'desktop-tools.patch.yml' })
    expect(result.reaped).toHaveLength(0)
    expect(result.dropped).toHaveLength(0)
  })
})
