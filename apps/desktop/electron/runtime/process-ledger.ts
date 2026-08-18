/**
 * Task 7.1 — process ledger: durable record of the dsh child spawned by this
 * app, used to reap leftovers after crashes / force-quits.
 *
 * The ledger is intentionally SEPARATE from `runtime-manifest.ts` (which is
 * the dsh-version upgrade manifest, Task 2.3). This file records WHO we
 * spawned, WHEN, and on WHICH port — the identity needed for triple-checked
 * orphan reaping (plan v1.4, §3.1/§3.2).
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const LEDGER_FILE = 'process-ledger.json'

export interface LedgerSpawned {
  /** pid of the spawned dsh child. */
  pid: number
  /** epoch ms recorded immediately BEFORE spawn() — compared against ps etime. */
  startedAt: number
  /** fixed port when known, else null (--port 0 flow; readyUrl is authoritative). */
  port: number | null
  /** base URL once the server is known to be ready (probed). */
  readyUrl: string | null
  /** dsh version captured at spawn time, for reuse verification (R13). */
  dshVersion: string | null
  /** true when this instance was adopted (not spawned by this run) — relaxed check (R17). */
  adopted: boolean
}

export interface ProcessLedger {
  version: 2
  spawned: LedgerSpawned | null
  lastExit: {
    kind: 'clean' | 'crash' | 'unknown'
    at: number
  }
}

export function emptyLedger(): ProcessLedger {
  return { version: 2, spawned: null, lastExit: { kind: 'unknown', at: 0 } }
}

/**
 * Read the ledger. Corrupt / missing / wrong-version files are backed up
 * (R25) and treated as an empty ledger — a cold start must never block on a
 * broken ledger.
 */
export function loadLedger(dir: string): ProcessLedger {
  const file = join(dir, LEDGER_FILE)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return emptyLedger()
  }
  try {
    const parsed = JSON.parse(raw) as ProcessLedger
    if (parsed.version !== 2) throw new Error(`unsupported ledger version ${parsed.version}`)
    return {
      version: 2,
      spawned: parsed.spawned ?? null,
      lastExit: parsed.lastExit ?? { kind: 'unknown', at: 0 }
    }
  } catch {
    // R25: back up the corrupt file for forensics, then cold-start.
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* best effort */
    }
    return emptyLedger()
  }
}

/** Atomic write (R6): tmp + rename. Synchronous so exit paths can rely on it (R7). */
export function saveLedger(dir: string, ledger: ProcessLedger): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, LEDGER_FILE)
  const tmp = join(dir, `${LEDGER_FILE}.tmp`)
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8')
  renameSync(tmp, file)
}

/** Clean up a leftover .tmp from an interrupted atomic write (R25 note). */
export function cleanLedgerTmp(dir: string): void {
  try {
    rmSync(join(dir, `${LEDGER_FILE}.tmp`), { force: true })
  } catch {
    /* best effort */
  }
}

export function ledgerPath(dir: string): string {
  return join(dir, LEDGER_FILE)
}

export { dirname }
