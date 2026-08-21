// tests/plugin/rpc.test.ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addAllowedRoot } from '../../src/plugin/paths.ts'
import { dispatchFpCall, listDir, readText, statPath } from '../../src/plugin/rpc.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-test-'))
  addAllowedRoot(dir)
  writeFileSync(join(dir, 'a.md'), '# Hi\n')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'b.txt'), 'hello')
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

describe('listDir', () => {
  it('目录优先排序并返回条目', async () => {
    const entries = await listDir(dir)
    expect(entries[0]!.isDir).toBe(true)
    expect(entries[0]!.name).toBe('sub')
    expect(entries[1]!.name).toBe('a.md')
  })
})

describe('readText', () => {
  it('读取文本并带 mtime', async () => {
    const r = await readText(join(dir, 'a.md'))
    expect(r.text).toBe('# Hi\n')
    expect(r.truncated).toBe(false)
    expect(typeof r.mtime).toBe('number')
  })
  it('超过 maxBytes 截断', async () => {
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(100))
    const r = await readText(join(dir, 'big.txt'), 10)
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBe(10)
  })
})

describe('statPath', () => {
  it('报告存在与类型', async () => {
    const s = await statPath(join(dir, 'a.md'))
    expect(s.exists).toBe(true)
    expect(s.isDir).toBe(false)
    expect(s.ext).toBe('.md')
  })

  it('切换工作区根目录后允许访问该目录', async () => {
    const nextRoot = mkdtempSync(join(tmpdir(), 'fp-workspace-'))
    try {
      writeFileSync(join(nextRoot, 'README.md'), '# Workspace\n')
      const result = await dispatchFpCall(dir, { fn: 'setRoot', root: nextRoot }) as { root: string }
      expect(result.root).toBe(nextRoot)
      const entries = await listDir(nextRoot)
      expect(entries.map((entry) => entry.name)).toContain('README.md')
    } finally {
      rmSync(nextRoot, { recursive: true, force: true })
    }
  })
})
