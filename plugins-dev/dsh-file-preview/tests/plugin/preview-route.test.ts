// tests/plugin/preview-route.test.ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addAllowedRoot } from '../../src/plugin/paths.ts'
import { previewHandler } from '../../src/plugin/preview-route.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-pv-'))
  addAllowedRoot(dir)
  writeFileSync(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

/** Minimal pipe-compatible ServerResponse double: records writeHead calls. */
function fakeRes() {
  const calls: Array<[number, Record<string, string>]> = []
  const res = {
    writeHead: (code: number, headers: Record<string, string>) => { calls.push([code, headers]) },
    write: () => true,
    end: () => {},
    destroy: () => {},
    on: () => {},
    once: () => {},
    emit: () => true,
    writable: true,
  } as unknown as ServerResponse
  return { res, calls }
}

describe('previewHandler', () => {
  it('GET 返回文件与正确 Content-Type', async () => {
    const { res, calls } = fakeRes()
    const req = { method: 'GET', url: `/preview/${encodeURIComponent(join(dir, 'pic.png'))}` } as IncomingMessage
    await previewHandler(req, res)
    expect(calls[0]![0]).toBe(200)
    expect(calls[0]![1]['Content-Type']).toBe('image/png')
  })
  it('越界路径返回 403', async () => {
    const { res, calls } = fakeRes()
    const req = { method: 'GET', url: `/preview/${encodeURIComponent('/etc/passwd')}` } as IncomingMessage
    await previewHandler(req, res)
    expect(calls[0]![0]).toBe(403)
  })
  it('非 GET/HEAD 返回 405', async () => {
    const { res, calls } = fakeRes()
    const req = { method: 'POST', url: '/preview/x' } as IncomingMessage
    await previewHandler(req, res)
    expect(calls[0]![0]).toBe(405)
  })
  it('HEAD 只写头不输出 body', async () => {
    const { res, calls } = fakeRes()
    const req = { method: 'HEAD', url: `/preview/${encodeURIComponent(join(dir, 'pic.png'))}` } as IncomingMessage
    await previewHandler(req, res)
    expect(calls[0]![0]).toBe(200)
    expect(calls[0]![1]['Content-Length']).toBe(4)
  })
})
