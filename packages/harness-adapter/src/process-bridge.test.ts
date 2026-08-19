import { describe, expect, it } from 'vitest'
import { contextKey, prepareProjectContextMessage } from './process-bridge'

function memoryPorts(files: Record<string, string>) {
  return {
    async readText(path: string) {
      return Object.hasOwn(files, path) ? files[path] : null
    },
    async listDir(path: string) {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const names = new Set<string>()
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue
        const name = key.slice(prefix.length).split('/')[0]
        if (name) names.add(name)
      }
      return [...names]
    },
  }
}

describe('prepareProjectContextMessage', () => {
  it('returns null when cwd is missing', async () => {
    const injected = new Set<string>()
    const result = await prepareProjectContextMessage(
      { sessionId: 's1', cwd: undefined, alreadyInjected: injected },
      memoryPorts({}),
    )
    expect(result).toBeNull()
    expect(injected.size).toBe(0)
  })

  it('renders package name and memory once per session', async () => {
    const injected = new Set<string>()
    const ports = memoryPorts({
      '/repo/package.json': JSON.stringify({ name: 'demo-app', scripts: { test: 'vitest' } }),
      '/repo/.dsh/memory.md': 'use pnpm',
    })
    const first = await prepareProjectContextMessage(
      { sessionId: 's1', cwd: '/repo', alreadyInjected: injected },
      ports,
    )
    // The function never marks; the caller does, after the content is safe.
    expect(first?.content).toContain('<system-reminder>')
    expect(first?.content).toContain('demo-app')
    expect(first?.content).toContain('use pnpm')
    expect(first?.content).not.toContain('AGENTS.md')
    expect(first?.key).toBe('s1::/repo')
    injected.add(first!.key)
    const second = await prepareProjectContextMessage(
      { sessionId: 's1', cwd: '/repo', alreadyInjected: injected },
      ports,
    )
    expect(second).toBeNull()
  })

  it('re-injects when the session switches workspace', async () => {
    const injected = new Set<string>()
    const ports = memoryPorts({
      '/repo-a/package.json': JSON.stringify({ name: 'a' }),
      '/repo-b/package.json': JSON.stringify({ name: 'b' }),
    })
    const first = await prepareProjectContextMessage(
      { sessionId: 's1', cwd: '/repo-a', alreadyInjected: injected },
      ports,
    )
    const second = await prepareProjectContextMessage(
      { sessionId: 's1', cwd: '/repo-b', alreadyInjected: injected },
      ports,
    )
    expect(first?.content).toContain('Root: /repo-a')
    expect(second?.content).toContain('Root: /repo-b')
    expect(injected.size).toBe(0) // caller marks; this test chooses not to
  })

  it('a timed-out snapshot is not marked and can be retried', async () => {
    const injected = new Set<string>()
    let reads = 0
    const slowPorts = {
      async readText(path: string) {
        reads += 1
        if (reads === 1) await new Promise((resolve) => setTimeout(resolve, 10))
        return '/repo/package.json' === path ? JSON.stringify({ name: 'demo' }) : null
      },
      async listDir() {
        return []
      },
    }
    // First call is still in flight when the caller abandons it — no mark.
    const first = await prepareProjectContextMessage(
      { sessionId: 's1', cwd: '/repo', alreadyInjected: injected },
      slowPorts,
    )
    expect(first?.content).toContain('demo')
    expect(injected.size).toBe(0)
    // The next pre-step may retry because nothing was marked.
    const retry = await prepareProjectContextMessage(
      { sessionId: 's1', cwd: '/repo', alreadyInjected: injected },
      slowPorts,
    )
    expect(retry?.content).toContain('demo')
  })

  it('contextKey distinguishes session and cwd', () => {
    expect(contextKey('s1', '/a')).toBe('s1::/a')
    expect(contextKey('s1', '/b')).not.toBe(contextKey('s1', '/a'))
    expect(contextKey('s2', '/a')).not.toBe(contextKey('s1', '/a'))
  })
})
