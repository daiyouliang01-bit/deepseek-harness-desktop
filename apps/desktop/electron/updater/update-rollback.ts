/**
 * Cross-restart update rollback (from anywhere-labs update handling):
 * after an update is downloaded and marked pending-install, the next launch
 * records its own health. If the app then crashes (see CrashEvidence) the
 * pending-install marker combined with the crash evidence tells us the new
 * build did not take, and the user is offered a rollback to the previous
 * runtime version (runtime-manifest keeps `previous`).
 *
 * Pure + file-backed so it is unit-testable outside Electron.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PendingInstall {
  version: string
  markedAt: number
}

export interface RollbackState {
  pendingInstall: PendingInstall | null
  /** whether the previous launch crashed while a pending install existed */
  rollbackSuggested: boolean
}

export interface UpdateRollbackOptions {
  dir: string
  now?: () => number
}

const PENDING_FILE = 'pending-update.json'

export class UpdateRollback {
  private readonly dir: string
  private readonly now: () => number

  constructor(options: UpdateRollbackOptions) {
    this.dir = options.dir
    this.now = options.now ?? Date.now
  }

  /** Mark a downloaded update as pending install (called before quitAndInstall). */
  markPendingInstall(version: string): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, PENDING_FILE), JSON.stringify({ version, markedAt: this.now() } as PendingInstall), {
      mode: 0o600
    })
  }

  /** Clear the pending marker (called once the new version boots cleanly). */
  clearPending(): void {
    try {
      rmSync(join(this.dir, PENDING_FILE), { force: true })
    } catch {
      /* ignore */
    }
  }

  readPending(): PendingInstall | null {
    const p = join(this.dir, PENDING_FILE)
    if (!existsSync(p)) return null
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as PendingInstall
      return typeof raw.version === 'string' ? raw : null
    } catch {
      return null
    }
  }

  /**
   * Evaluate the rollback state after a launch: if a pending install existed
   * AND the previous run crashed (evidence left behind), the new build failed
   * to take → suggest rollback. A clean boot clears the pending marker.
   */
  evaluate(crashed: boolean): RollbackState {
    const pending = this.readPending()
    if (!pending) return { pendingInstall: null, rollbackSuggested: false }
    if (crashed) {
      return { pendingInstall: pending, rollbackSuggested: true }
    }
    this.clearPending()
    return { pendingInstall: pending, rollbackSuggested: false }
  }
}
