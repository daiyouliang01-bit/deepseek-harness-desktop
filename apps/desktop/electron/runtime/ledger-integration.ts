/**
 * Task 7.1 — ledger integration: wires the process ledger, orphan reaper and
 * coexistence detection into the app lifecycle (plan v1.4).
 *
 * This module owns:
 *  - the ledger file location (userData/state/process-ledger.json)
 *  - recording spawn/ready/stop via HarnessProcess callbacks
 *  - reaping ledger orphans before each spawn
 *  - reporting coexisting (non-ledger) dsh instances
 */

import { join } from 'node:path'
import type { ReadyInfo } from './runtime-types'
import { emptyLedger, loadLedger, saveLedger, type ProcessLedger } from './process-ledger'
import { reapLedgerOrphan, type ReapResult } from './orphan-reaper'
import { detectCoexistingInstances, type CoexistingInstance } from './coexistence'
import { execFileSync } from 'node:child_process'

export interface LedgerIntegrationOptions {
  /** userData directory; ledger lives under state/. */
  userDataDir: string
  /** App signature substring used for R19 classification & R27 arg matching. */
  appSignature: string
  /** dsh version captured at spawn (R13), e.g. from `dsh --version`. */
  dshVersion?: string | null
}

export class LedgerIntegration {
  readonly ledgerDir: string
  private readonly signature: string
  private dshVersion: string | null

  constructor(private readonly options: LedgerIntegrationOptions) {
    this.ledgerDir = join(options.userDataDir, 'state')
    this.signature = options.appSignature
    this.dshVersion = options.dshVersion ?? null
  }

  /** Current ledger (empty when absent). */
  ledger(): ProcessLedger {
    return loadLedger(this.ledgerDir)
  }

  /** Reap the ledger's orphan before a spawn. Returns what happened. */
  async reapBeforeSpawn(): Promise<ReapResult> {
    return reapLedgerOrphan({
      ledgerDir: this.ledgerDir,
      appSignature: this.signature,
      toleranceMs: 5000,
      termGraceMs: 2000
    })
  }

  /** Record a fresh spawn (called from HarnessProcess.onSpawned). */
  recordSpawned(pid: number, startedAt: number): void {
    if (!pid) return
    const ledger = loadLedger(this.ledgerDir)
    saveLedger(this.ledgerDir, {
      ...ledger,
      spawned: {
        pid,
        startedAt,
        port: null,
        readyUrl: null,
        dshVersion: this.dshVersion,
        adopted: false
      }
    })
  }

  /** Record readiness (called from HarnessProcess.onReady). */
  recordReady(info: ReadyInfo): void {
    const ledger = loadLedger(this.ledgerDir)
    if (!ledger.spawned || ledger.spawned.pid === undefined) return
    saveLedger(this.ledgerDir, {
      ...ledger,
      spawned: {
        ...ledger.spawned,
        port: info.port,
        readyUrl: info.url
      }
    })
  }

  /** Record a clean stop (called from HarnessProcess.onStopped(clean=true)). */
  recordCleanStop(): void {
    const ledger = loadLedger(this.ledgerDir)
    saveLedger(this.ledgerDir, {
      ...ledger,
      spawned: null,
      lastExit: { kind: 'clean', at: Date.now() }
    })
  }

  /** Record a crash/unknown exit (called from onStopped(false) / process exit). */
  recordUnexpectedExit(): void {
    const ledger = loadLedger(this.ledgerDir)
    saveLedger(this.ledgerDir, {
      ...ledger,
      lastExit: { kind: 'crash', at: Date.now() }
    })
  }

  /**
   * Detect dsh instances running outside the ledger (R2/R19). Report-only.
   */
  detectCoexisting(): CoexistingInstance[] {
    const ledger = loadLedger(this.ledgerDir)
    const managed = new Set(ledger.spawned ? [ledger.spawned.pid] : [])
    return detectCoexistingInstances({
      appSignature: this.signature,
      managedPids: managed,
      dshMarkers: ['bin.js', 'dsh']
    })
  }

  /** Test-friendly variant with an injected ps scanner. */
  detectCoexistingWithScanner(scanner: () => string): CoexistingInstance[] {
    const ledger = loadLedger(this.ledgerDir)
    const managed = new Set(ledger.spawned ? [ledger.spawned.pid] : [])
    return detectCoexistingInstances(
      {
        appSignature: this.signature,
        managedPids: managed,
        dshMarkers: ['bin.js', 'dsh']
      },
      scanner
    )
  }

  /** App-signature of a process for diagnostics (R19). */
  hasAppSignature(command: string): boolean {
    return command.includes(this.signature)
  }

  /**
   * Phase 2.3 (R5/R8/R13): try to reuse an already-running dsh instead of
   * spawning. Checks (in order):
   *   1. the ledger's recorded readyUrl — live probe, no time-window heuristic
   *   2. the preferred fixed port — if occupied, verify it IS a dsh
   * Both paths require the `__DSH_BOOT__` marker (R8) so we never adopt a
   * random web server; the ledger dshVersion is compared when known (R13).
   *
   * Returns the ReadyInfo to adopt, or null when nothing reusable was found.
   */
  async tryReuse(port?: number, probeTimeoutMs = 5000): Promise<import('./runtime-types').ReadyInfo | null> {
    const ledger = loadLedger(this.ledgerDir)
    const candidates: Array<{ url: string; checkVersion: boolean }> = []
    if (ledger.spawned?.readyUrl) {
      candidates.push({ url: ledger.spawned.readyUrl, checkVersion: true })
    }
    if (port !== undefined) {
      const url = `http://127.0.0.1:${port}`
      if (!candidates.some((c) => c.url === url)) {
        candidates.push({ url, checkVersion: false })
      }
    }
    for (const { url, checkVersion } of candidates) {
      if (await this.probeDsh(url, probeTimeoutMs)) {
        if (checkVersion && ledger.spawned?.dshVersion && this.dshVersion && ledger.spawned.dshVersion !== this.dshVersion) {
          // R13: version drift — do not adopt; caller will kill & respawn.
          continue
        }
        const m = url.match(/:(\d+)/)
        return { url, port: m ? Number(m[1]) : 0, startupMs: 0 }
      }
    }
    return null
  }

  /** GET / and require the DSH boot marker (R8). Any HTTP status is fine as
   * long as the body identifies the DSH web app. */
  private async probeDsh(url: string, timeoutMs: number): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, { signal: controller.signal })
        const text = await res.text()
        return text.includes('__DSH_BOOT__')
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return false
    }
  }
}

import type { RuntimeDescriptor } from './dsh-bin'

/** Read the current dsh version string (best effort, R13). */
export function readDshVersion(runtime: RuntimeDescriptor): string | null {
  try {
    const out = execFileSync(runtime.command, [...runtime.prefixArgs, '--version'], { encoding: 'utf8', timeout: 5000 })
    return out.split('\n')[0]?.trim() ?? null
  } catch {
    return null
  }
}

export { emptyLedger }
