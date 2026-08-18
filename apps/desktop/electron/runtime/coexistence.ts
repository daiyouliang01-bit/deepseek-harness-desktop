/**
 * Task 7.1 — coexistence detection (R2/R19): find dsh instances running
 * outside the app's ledger and classify them by app signature.
 *
 * IMPORTANT: this module only REPORTS. It never kills. Killing is restricted
 * to ledger-confirmed pids in orphan-reaper.ts.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { ProcessLedger } from './process-ledger'

/** Absolute ps path — PATH may be stripped in minimal shells / vitest forks. */
const PS_BIN = process.platform === 'win32' ? null : ['/bin/ps', '/usr/bin/ps'].find((p) => existsSync(p)) ?? 'ps'

export interface CoexistingInstance {
  pid: number
  command: string
  /** R19: true when the command line carries the app patch signature. */
  appSignature: boolean
  /** R19 classification. */
  kind: 'app-orphan' | 'manual'
}

export interface CoexistenceOptions {
  /** Substring identifying the app's own dsh spawns (R19). */
  appSignature?: string
  /** Extra argv substrings that make a candidate count as a dsh instance. */
  dshMarkers?: string[]
  /** Pids managed by the ledger — never reported as coexisting. */
  managedPids?: Set<number>
}

/**
 * Scan the process table for dsh instances (report-only). On POSIX uses
 * `ps aux`; the caller may inject a different scanner in tests.
 */
export function detectCoexistingInstances(
  options: CoexistenceOptions = {},
  scanner: (() => string) | null = null
): CoexistingInstance[] {
  const signature = options.appSignature ?? 'desktop-tools.patch.yml'
  const markers = options.dshMarkers ?? ['dsh', 'bin.js']
  const managed = options.managedPids ?? new Set<number>()

  let raw: string
  try {
    raw = scanner ? scanner() : PS_BIN === null ? '' : execFileSync(PS_BIN, ['aux'], { encoding: 'utf8' })
  } catch {
    return []
  }

  const found: CoexistingInstance[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    // ps aux: USER PID %CPU ... COMMAND — the command is everything after the
    // numeric pid column. Match defensively: any leading tokens, then a pid,
    // then the rest as command (handles both full ps aux and test fixtures).
    const m = line.match(/^\S+\s+(\d+)\s+(.*)$/)
    if (!m) continue
    const pid = Number(m[1])
    const cmd = m[2]
    if (managed.has(pid)) continue
    const isDsh = markers.some((mk) => cmd.includes(mk))
    if (!isDsh) continue
    const hasSignature = cmd.includes(signature)
    found.push({
      pid,
      command: cmd.slice(0, 200),
      appSignature: hasSignature,
      kind: hasSignature ? 'app-orphan' : 'manual'
    })
  }
  return found
}

/** Group a coexistence scan into the two R19 buckets. */
export function classifyCoexisting(instances: CoexistingInstance[]): {
  appOrphans: CoexistingInstance[]
  manual: CoexistingInstance[]
} {
  return {
    appOrphans: instances.filter((i) => i.kind === 'app-orphan'),
    manual: instances.filter((i) => i.kind === 'manual')
  }
}

export function ledgersManagedPids(ledger: ProcessLedger): Set<number> {
  return new Set(ledger.spawned ? [ledger.spawned.pid] : [])
}
