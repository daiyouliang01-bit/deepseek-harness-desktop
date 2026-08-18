import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LedgerIntegration, readDshVersion } from './ledger-integration'
import { loadLedger } from './process-ledger'

describe('LedgerIntegration', () => {
  let dir: string
  let ledger: LedgerIntegration

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ledger-int-'))
    ledger = new LedgerIntegration({
      userDataDir: dir,
      appSignature: 'desktop-tools.patch.yml',
      dshVersion: '0.1.0-test'
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('records spawn → ready → clean stop lifecycle', () => {
    ledger.recordSpawned(4242, 1_000_000)
    let l = loadLedger(ledger.ledgerDir)
    expect(l.spawned?.pid).toBe(4242)
    expect(l.spawned?.dshVersion).toBe('0.1.0-test')
    expect(l.spawned?.readyUrl).toBeNull()

    ledger.recordReady({ url: 'http://127.0.0.1:35880', port: 35880, startupMs: 42 })
    l = loadLedger(ledger.ledgerDir)
    expect(l.spawned?.readyUrl).toBe('http://127.0.0.1:35880')
    expect(l.spawned?.port).toBe(35880)

    ledger.recordCleanStop()
    l = loadLedger(ledger.ledgerDir)
    expect(l.spawned).toBeNull()
    expect(l.lastExit.kind).toBe('clean')
  })

  it('recordUnexpectedExit marks the exit as crash but keeps spawned', () => {
    ledger.recordSpawned(4242, 1_000_000)
    ledger.recordUnexpectedExit()
    const l = loadLedger(ledger.ledgerDir)
    expect(l.lastExit.kind).toBe('crash')
    expect(l.spawned?.pid).toBe(4242) // kept so the next launch can reap it
  })

  it('reapBeforeSpawn no-ops on an empty ledger', async () => {
    const result = await ledger.reapBeforeSpawn()
    expect(result.reaped).toHaveLength(0)
    expect(result.dropped).toHaveLength(0)
  })

  it('detectCoexisting ignores the managed pid', () => {
    ledger.recordSpawned(4242, Date.now())
    // ps sample: our managed pid + a manual instance + unrelated process
    const scanner = () =>
      `USER   PID  COMMAND
litong  4242 node .../bin.js --patch /app/resources/desktop-tools.patch.yml --profile web
litong  9999 node .../bin.js web --host 127.0.0.1 --port 0
litong  1111 /Applications/Cursor.app/Contents/MacOS/Cursor
`
    const found = ledger.detectCoexistingWithScanner(scanner)
    expect(found.map((i) => i.pid)).toEqual([9999])
    expect(found[0].kind).toBe('manual')
  })
})

describe('LedgerIntegration.tryReuse (Phase 2.3)', () => {
  let dir: string
  let ledger: LedgerIntegration

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reuse-'))
    ledger = new LedgerIntegration({ userDataDir: dir, appSignature: 'desktop-tools.patch.yml', dshVersion: '0.1.0-test' })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('reuses the ledger readyUrl when it serves __DSH_BOOT__ (R5/R8)', async () => {
    ledger.recordSpawned(4242, Date.now() - 60_000)
    ledger.recordReady({ url: 'http://127.0.0.1:35880', port: 35880, startupMs: 10 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><script>window.__DSH_BOOT__ = {}</script></html>', { status: 200 })
    )
    const info = await ledger.tryReuse(35880)
    expect(info?.url).toBe('http://127.0.0.1:35880')
    expect(info?.port).toBe(35880)
  })

  it('returns null when the probe does not serve __DSH_BOOT__ (R8 — not a dsh)', async () => {
    ledger.recordSpawned(4242, Date.now() - 60_000)
    ledger.recordReady({ url: 'http://127.0.0.1:35880', port: 35880, startupMs: 10 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>some other app</html>', { status: 200 }))
    const info = await ledger.tryReuse(35880)
    expect(info).toBeNull()
  })

  it('returns null when the probe fails (nothing listening)', async () => {
    ledger.recordSpawned(4242, Date.now() - 60_000)
    ledger.recordReady({ url: 'http://127.0.0.1:35880', port: 35880, startupMs: 10 })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('conn refused'))
    const info = await ledger.tryReuse(35880)
    expect(info).toBeNull()
  })

  it('returns null on dshVersion mismatch (R13)', async () => {
    ledger.recordSpawned(4242, Date.now() - 60_000)
    ledger.recordReady({ url: 'http://127.0.0.1:35880', port: 35880, startupMs: 10 })
    // ledger spawned with an OLD version; current binary is new
    const { saveLedger, loadLedger } = await import('./process-ledger')
    const l = loadLedger(ledger.ledgerDir)
    saveLedger(ledger.ledgerDir, { ...l, spawned: l.spawned ? { ...l.spawned, dshVersion: '0.0.9-old' } : null })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><script>window.__DSH_BOOT__ = {}</script></html>', { status: 200 })
    )
    const info = await ledger.tryReuse(35880)
    expect(info).toBeNull()
  })

  it('reuses the fixed port even without a ledger entry when it serves dsh', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><script>window.__DSH_BOOT__ = {}</script></html>', { status: 200 })
    )
    const info = await ledger.tryReuse(35880)
    expect(info?.url).toBe('http://127.0.0.1:35880')
  })
})

describe('readDshVersion', () => {
  it('returns null when the binary is missing (never throws)', () => {
    expect(readDshVersion({ command: '/nonexistent/dsh', prefixArgs: [], label: 'missing' })).toBeNull()
  })
})
