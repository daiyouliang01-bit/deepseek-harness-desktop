import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCompatibilityChecks } from './compatibility'

describe('compatibility checks', () => {
  let tmp: string

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dshd-compat-'))
  })
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('passes when dsh exists, node is new enough, and data dir is writable', async () => {
    const res = await runCompatibilityChecks({ dataDir: tmp })
    expect(res.ok).toBe(true)
    const names = res.checks.map((c) => c.name)
    expect(names).toContain('dsh executable')
    expect(names).toContain('node version')
    expect(names).toContain('data directory')
  })

  it('fails with recovery when the executable is missing', async () => {
    const res = await runCompatibilityChecks({ dshBin: 'definitely-not-a-real-bin-xyz' })
    expect(res.ok).toBe(false)
    expect(res.recovery).toMatch(/missing/)
  })

  it('fails when node major is below the floor', async () => {
    const res = await runCompatibilityChecks({ minNodeMajor: 999 })
    expect(res.ok).toBe(false)
    expect(res.recovery).toMatch(/Node\.js 999\+/)
  })

  it('fails on dsh major version mismatch', async () => {
    const res = await runCompatibilityChecks({ expectedDshVersion: '0.999.0' })
    expect(res.ok).toBe(false)
    expect(res.recovery).toMatch(/version mismatch/)
  })

  it('passes when dsh major matches expected', async () => {
    const res = await runCompatibilityChecks({ expectedDshVersion: '0.1.0' })
    expect(res.ok).toBe(true)
  })

  it('fails when the data directory is missing', async () => {
    const res = await runCompatibilityChecks({ dataDir: join(tmp, 'does-not-exist') })
    expect(res.ok).toBe(false)
    expect(res.recovery).toMatch(/Data directory/)
  })

  it('fails when the loopback health probe gets no answer', async () => {
    // bind a port then close it so nothing listens
    const port = await bindFreePort()
    const res = await runCompatibilityChecks({ healthUrl: `http://127.0.0.1:${port}/` })
    expect(res.ok).toBe(false)
    expect(res.recovery).toMatch(/not responding/)
  })

  it('passes when a real loopback server answers', async () => {
    const server = createHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '2' })
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    try {
      const res = await runCompatibilityChecks({ healthUrl: `http://127.0.0.1:${port}/`, healthTimeoutMs: 3_000 })
      expect(res.ok).toBe(true)
      expect(res.checks.find((c) => c.name === 'loopback health')?.passed).toBe(true)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('records required capabilities as informational checks', async () => {
    const res = await runCompatibilityChecks({ requiredCapabilities: ['stream'] })
    expect(res.ok).toBe(true)
    expect(res.checks.some((c) => c.name === 'capability: stream')).toBe(true)
  })
})

function bindFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      s.close(() => resolve(port))
    })
  })
}

// keep writeFileSync referenced for future corrupt-data-dir test
void writeFileSync
