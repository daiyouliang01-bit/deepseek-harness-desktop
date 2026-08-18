/**
 * Crash evidence (from anywhere-labs crash-evidence.ts, adapted to our
 * standalone shell): record each run's start in a durable marker file; a
 * leftover marker on the next launch means the previous run did not exit
 * cleanly (crash / force-kill). The UI can surface this and offer recovery.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface RunEvidence {
  pid: number
  startedAt: number
  appVersion: string
  dshVersion?: string
  argv: string[]
}

export interface CrashEvidenceOptions {
  /** directory holding evidence files (e.g. userData/crash-evidence) */
  dir: string
  appVersion: string
  dshVersion?: () => string | undefined
  now?: () => number
}

const ACTIVE_FILE = 'active-run.json'

export class CrashEvidence {
  private readonly dir: string
  private readonly appVersion: string
  private readonly dshVersion?: () => string | undefined
  private readonly now: () => number
  private cleaned = false

  constructor(options: CrashEvidenceOptions) {
    this.dir = options.dir
    this.appVersion = options.appVersion
    this.dshVersion = options.dshVersion
    this.now = options.now ?? Date.now
  }

  /** Whether the previous run left a marker (i.e. did not exit cleanly). */
  previousRunCrashed(): boolean {
    return existsSync(this.evidencePath())
  }

  /** Read the previous run's evidence (null when the last run was clean). */
  readPrevious(): RunEvidence | null {
    const p = this.evidencePath()
    if (!existsSync(p)) return null
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as RunEvidence
    } catch {
      return null
    }
  }

  /** Record this run's start (idempotent within the process). */
  beginRun(): void {
    if (this.cleaned) return
    mkdirSync(this.dir, { recursive: true })
    const evidence: RunEvidence = {
      pid: process.pid,
      startedAt: this.now(),
      appVersion: this.appVersion,
      dshVersion: this.dshVersion?.(),
      argv: process.argv.slice(1)
    }
    writeFileSync(this.evidencePath(), JSON.stringify(evidence, null, 2), { mode: 0o600 })
  }

  /** Called on clean shutdown: remove the marker so the next launch is clean. */
  markCleanExit(): void {
    this.cleaned = true
    try {
      rmSync(this.evidencePath(), { force: true })
    } catch {
      /* ignore */
    }
  }

  private evidencePath(): string {
    return join(this.dir, ACTIVE_FILE)
  }
}

export { dirname }
