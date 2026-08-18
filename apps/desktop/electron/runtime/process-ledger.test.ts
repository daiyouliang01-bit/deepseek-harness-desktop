import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyLedger, LEDGER_FILE, loadLedger, saveLedger, cleanLedgerTmp } from './process-ledger'

describe('process-ledger', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ledger-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty ledger when the file is missing', () => {
    const ledger = loadLedger(dir)
    expect(ledger.spawned).toBeNull()
    expect(ledger.lastExit.kind).toBe('unknown')
  })

  it('round-trips a spawned record via atomic write', () => {
    saveLedger(dir, {
      version: 2,
      spawned: { pid: 4242, startedAt: 123456789, port: 35880, readyUrl: 'http://127.0.0.1:35880', dshVersion: '0.1.0-rc.6', adopted: false },
      lastExit: { kind: 'clean', at: 987654321 }
    })
    const ledger = loadLedger(dir)
    expect(ledger.spawned?.pid).toBe(4242)
    expect(ledger.spawned?.readyUrl).toBe('http://127.0.0.1:35880')
    expect(ledger.lastExit.kind).toBe('clean')
    // no .tmp leftover after a clean atomic write
    expect(readFileSync(join(dir, LEDGER_FILE), 'utf8')).toContain('4242')
  })

  it('backs up a corrupt file and cold-starts as empty (R25)', () => {
    writeFileSync(join(dir, LEDGER_FILE), '{"version": 2, "spawned": {"pid": 9') // truncated JSON
    const ledger = loadLedger(dir)
    expect(ledger.spawned).toBeNull()
    // a .corrupt-* backup exists
    const files = require('node:fs').readdirSync(dir) as string[]
    expect(files.some((f) => f.startsWith(`${LEDGER_FILE}.corrupt-`))).toBe(true)
  })

  it('treats an unsupported version as empty', () => {
    writeFileSync(join(dir, LEDGER_FILE), JSON.stringify({ version: 99, spawned: { pid: 1 } }))
    const ledger = loadLedger(dir)
    expect(ledger.spawned).toBeNull()
  })

  it('cleanLedgerTmp removes leftover tmp files (R25 note)', () => {
    writeFileSync(join(dir, `${LEDGER_FILE}.tmp`), 'partial')
    cleanLedgerTmp(dir)
    const files = require('node:fs').readdirSync(dir) as string[]
    expect(files).not.toContain(`${LEDGER_FILE}.tmp`)
  })

  it('emptyLedger is version 2 with null spawned', () => {
    const l = emptyLedger()
    expect(l.version).toBe(2)
    expect(l.spawned).toBeNull()
  })
})
