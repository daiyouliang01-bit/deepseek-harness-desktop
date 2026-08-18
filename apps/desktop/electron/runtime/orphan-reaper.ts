/**
 * Task 7.1 — orphan reaper: triple-checked cleanup of dsh processes left
 * behind by crashed / force-quit app runs (plan v1.4 §3.2/§3.3/§3.10).
 *
 * Safety contract (R1/R26/R27):
 *  - Only pids recorded in the process ledger are ever killed.
 *  - A pid is killed only when ALL of: it is alive, its start time matches
 *    the ledger (via `ps -o etime=`, locale-independent — R26), and its
 *    command line carries the app signature (R19/R27).
 *  - Anything else → ledger entry dropped, process untouched (PID reuse /
 *    manual instances are never harmed, S4).
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcessLedger } from './process-ledger'
import { emptyLedger, LEDGER_FILE, loadLedger, saveLedger } from './process-ledger'

export interface ProcessProbe {
  pid: number
  /** seconds the process has been running (ps etime), or null when unreadable. */
  uptimeSec: number | null
  state: string
  pgid: number
  command: string
}

export interface ReapOptions {
  /** Directory holding process-ledger.json (usually userData/state). */
  ledgerDir: string
  /** App signature substring required in the command line (R19). */
  appSignature?: string
  /** Extra signature substrings; all must be present when provided (R27). */
  requiredArgs?: string[]
  /** Start-time tolerance in ms (R26: ±5s). */
  toleranceMs?: number
  /** SIGTERM grace before SIGKILL escalation (R4). */
  termGraceMs?: number
  /** Kill signal escalation path for tests. */
  killFn?: (pid: number, signal: NodeJS.Signals) => boolean
  /** Process probe injection (tests). Defaults to probeProcess. */
  probeFn?: (pid: number) => ProcessProbe | null
}

interface KillOutcome {
  killed: boolean
  reason: string
}

/**
 * Read `ps -o etime= -o state= -o pgid= -o command=` for one pid.
 * Returns null when the process does not exist or the output is unreadable.
 * Parsing is defensive: any malformed line yields uptimeSec=null and the
 * caller treats it as "not confidently the ledger process" (fail-safe).
 *
 * Uses an absolute ps path: vitest's forks pool strips PATH, and `ps` may not
 * resolve via PATH lookup in that environment (or in other minimal shells).
 */
const PS_BIN = process.platform === 'win32' ? null : ['/bin/ps', '/usr/bin/ps'].find((p) => existsSync(p)) ?? 'ps'

export function probeProcess(pid: number): ProcessProbe | null {
  if (PS_BIN === null) return null
  try {
    // macOS/Linux ps: comma-separated -o keywords; a single string with spaces
    // ("etime= -o state=") fails with "keyword not found" on macOS.
    const out = execFileSync(PS_BIN, ['-o', 'etime=,state=,pgid=,command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const line = out.split('\n').find((l) => l.trim().length > 0)
    if (!line) return null
    // etime formats: HH:MM:SS | MM:SS | d-HH:MM:SS (locale-independent digits)
    const m = line.match(/^(\d+(?:-\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})?)\s+(\S+)\s+(\d+)\s+(.*)$/)
    if (!m) return { pid, uptimeSec: null, state: '', pgid: 0, command: '' }
    return { pid, uptimeSec: etimeToSeconds(m[1]), state: m[2], pgid: Number(m[3]), command: m[4] }
  } catch {
    return null // ESRCH etc. → process gone
  }
}

export function etimeToSeconds(etime: string): number | null {
  if (!etime) return null
  const parts = etime.split('-')
  let days = 0
  let hms = parts[parts.length - 1]
  if (parts.length === 2) days = Number(parts[0])
  const seg = hms.split(':').map(Number)
  if (seg.some((n) => Number.isNaN(n))) return null
  // ps etime: MM:SS (2 segments) or HH:MM:SS (3 segments)
  let total = 0
  if (seg.length === 3) total = seg[0] * 3600 + seg[1] * 60 + seg[2]
  else if (seg.length === 2) total = seg[0] * 60 + seg[1]
  else total = seg[0] ?? 0
  return days * 86400 + total
}

/**
 * Triple check (R1/R26/R27):
 *  ① process alive (probeProcess returned a row)
 *  ② start time matches the ledger's startedAt, via etime (R26)
 *  ③ command line carries the app signature (R19/R27)
 * Zombies (state Z) are treated as dead (R20).
 */
export function matchesLedger(
  probe: ProcessProbe | null,
  ledgerStartedAt: number,
  now: number,
  toleranceMs: number,
  appSignature: string | undefined,
  requiredArgs: string[]
): { match: boolean; reason: string } {
  if (!probe) return { match: false, reason: 'not-alive' }
  if (probe.state.includes('Z')) return { match: false, reason: 'zombie' }
  if (probe.uptimeSec === null) return { match: false, reason: 'etime-unreadable' }
  const calcStart = now - probe.uptimeSec * 1000
  if (Math.abs(calcStart - ledgerStartedAt) > toleranceMs) {
    return { match: false, reason: `etime-mismatch` }
  }
  if (appSignature && !probe.command.includes(appSignature)) {
    return { match: false, reason: 'signature-missing' }
  }
  for (const arg of requiredArgs) {
    if (!probe.command.includes(arg)) return { match: false, reason: `arg-missing:${arg}` }
  }
  return { match: true, reason: 'match' }
}

/**
 * Kill one process group, waiting for the target to die (R4/R20).
 * POSIX: SIGTERM → poll (state Z counts as dead) → SIGKILL → confirm.
 */
export async function killProcessGroup(
  pid: number,
  pgid: number,
  opts: { termGraceMs?: number; killFn?: (pid: number, signal: NodeJS.Signals) => boolean; probeFn?: (pid: number) => ProcessProbe | null } = {}
): Promise<boolean> {
  const grace = opts.termGraceMs ?? 2000
  const killFn = opts.killFn ?? ((p, sig) => {
    try {
      process.kill(p, sig)
      return true
    } catch {
      return false
    }
  })
  const probe = opts.probeFn ?? probeProcess
  // Negative pid = process group (POSIX). Fall back to the single pid when the
  // group is gone but the process survives (reparented edge cases).
  const groupKilled = killFn(-pgid, 'SIGTERM') || killFn(-pid, 'SIGTERM')
  if (!groupKilled) killFn(pid, 'SIGTERM')

  const deadline = Date.now() + grace
  while (Date.now() < deadline) {
    const p = probe(pid)
    if (!p || p.state.includes('Z')) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  killFn(-pgid, 'SIGKILL') || killFn(-pid, 'SIGKILL') || killFn(pid, 'SIGKILL')
  await new Promise((r) => setTimeout(r, 200))
  const p = probe(pid)
  return !p || p.state.includes('Z')
}

export interface ReapResult {
  /** pids actually killed. */
  reaped: number[]
  /** pids from the ledger that were dropped without killing (mismatch). */
  dropped: number[]
}

/**
 * Reap the ledger's spawned process if it is confidently ours (triple check),
 * then clear the ledger entry. Safe to call before every spawn.
 */
export async function reapLedgerOrphan(options: ReapOptions): Promise<ReapResult> {
  const ledger = loadLedger(options.ledgerDir)
  const result: ReapResult = { reaped: [], dropped: [] }
  if (!ledger.spawned) return result

  const { pid, startedAt } = ledger.spawned
  const now = Date.now()
  const probeFn = options.probeFn ?? probeProcess
  const probe = probeFn(pid)
  const { match, reason } = matchesLedger(
    probe,
    startedAt,
    now,
    options.toleranceMs ?? 5000,
    options.appSignature,
    options.requiredArgs ?? []
  )

  if (match) {
    const pgid = probe?.pgid ?? pid
    const dead = await killProcessGroup(pid, pgid, { termGraceMs: options.termGraceMs, killFn: options.killFn, probeFn })
    if (dead) {
      result.reaped.push(pid)
      await clearLedgerSpawned(options.ledgerDir, ledger)
    } else {
      // Could not confirm death — keep the ledger entry for the next attempt.
    }
  } else {
    // Mismatch (PID reuse / manual process / zombie): drop the entry, kill nothing.
    result.dropped.push(pid)
    await clearLedgerSpawned(options.ledgerDir, ledger)
  }
  return result
}

async function clearLedgerSpawned(dir: string, ledger: ProcessLedger): Promise<void> {
  saveLedger(dir, { ...ledger, spawned: null })
}

export function ledgerFileExists(dir: string): boolean {
  return existsSync(join(dir, LEDGER_FILE))
}

export { emptyLedger }
