import { describe, expect, it } from 'vitest'
import { renderProjectSnapshot, snapshotProject, truncateUtf8 } from './project-context'

function memoryIo(files: Record<string, string>) {
  return {
    async readText(path: string) {
      return Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null
    },
    async listDir(path: string) {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const names = new Set<string>()
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix) && key !== path) continue
        const rest = key.slice(prefix.length)
        const name = rest.split('/')[0]
        if (name) names.add(name)
      }
      return [...names]
    },
  }
}

describe('snapshotProject', () => {
  it('reads package.json name and scripts from an otherwise empty repo', async () => {
    const snapshot = await snapshotProject(
      '/repo',
      memoryIo({
        '/repo/package.json': JSON.stringify({
          name: 'demo-app',
          scripts: { test: 'vitest', lint: 'eslint .' },
        }),
      }),
    )
    expect(snapshot.root).toBe('/repo')
    expect(snapshot.manifestName).toBe('demo-app')
    expect(snapshot.scripts).toEqual(['test', 'lint'])
    expect(snapshot.tree).toEqual(['package.json'])
  })

  it('skips node_modules and does not throw on an empty repo', async () => {
    const snapshot = await snapshotProject(
      '/empty',
      memoryIo({
        '/empty/node_modules/left-pad/index.js': 'module.exports = 1',
      }),
    )
    expect(snapshot.manifestName).toBeUndefined()
    expect(snapshot.scripts).toEqual([])
    expect(snapshot.tree).not.toContain('node_modules')
  })
})

describe('renderProjectSnapshot', () => {
  it('does not include AGENTS.md body in the reminder', () => {
    const text = renderProjectSnapshot({
      root: '/repo',
      manifestName: 'demo-app',
      scripts: ['test'],
      tree: ['README.md', 'package.json'],
      omitted: 0,
      bytes: 0,
    })
    expect(text).toContain('<system-reminder>')
    expect(text).toContain('demo-app')
    expect(text).not.toContain('You must always')
  })

  it('caps rendered snapshot at 12000 bytes', () => {
    const text = renderProjectSnapshot({
      root: '/repo',
      scripts: Array.from({ length: 400 }, (_, i) => `script-${i}`),
      tree: Array.from({ length: 400 }, (_, i) => `file-${i}.ts`),
      omitted: 12,
      bytes: 0,
    })
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(12_000)
    expect(text).toContain('omitted')
  })

  it('reports the rendered byte size on the snapshot', () => {
    const snapshot = {
      root: '/repo',
      manifestName: 'demo-app',
      scripts: ['test'],
      tree: ['README.md'],
      omitted: 0,
      bytes: 0,
    }
    renderProjectSnapshot(snapshot)
    expect(snapshot.bytes).toBe(Buffer.byteLength(renderProjectSnapshot(snapshot), 'utf8'))
  })

  it('truncateUtf8 never splits a multi-byte character', () => {
    const text = '中文测试'.repeat(100)
    const cut = truncateUtf8(text, 100)
    expect(Buffer.byteLength(cut, 'utf8')).toBeLessThanOrEqual(100)
    expect(cut.endsWith('\uFFFD')).toBe(false)
    // Re-encoding the cut must not produce replacement chars from a split.
    expect(Buffer.from(cut, 'utf8').toString('utf8')).toBe(cut)
  })
})
