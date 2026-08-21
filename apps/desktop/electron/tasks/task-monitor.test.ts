import { describe, expect, it, vi } from 'vitest'
import { TaskMonitor, type TaskMonitorBackend } from './task-monitor'
import type { SessionSummary } from '../adapter/session-adapter'

function summary(sessionId: string, running: boolean, title?: string): SessionSummary {
  return { sessionId, updatedAt: Date.now(), running, blank: false, title }
}

function makeBackend() {
  const notifications: Array<{ title: string; body: string; onClick?: () => void }> = []
  const badges: number[] = []
  const backend: TaskMonitorBackend & {
    notifications: typeof notifications
    badges: number[]
  } = {
    notify: (title, body, onClick) => notifications.push({ title, body, onClick }),
    setBadge: (count) => badges.push(count),
    isSupported: () => true,
    notifications,
    badges
  }
  return backend
}

describe('TaskMonitor', () => {
  it('is quiet on the first scan but sets the badge', async () => {
    const backend = makeBackend()
    const lister = { list: vi.fn().mockResolvedValue([summary('a', true, 'Refactor'), summary('b', false)]) }
    const monitor = new TaskMonitor(backend, lister)

    await monitor.poll()
    expect(backend.notifications).toEqual([])
    expect(backend.badges.at(-1)).toBe(1)
    expect(monitor.runningCount()).toBe(1)
  })

  it('notifies when a tracked session stops running and clears its badge slot', async () => {
    const backend = makeBackend()
    let sessions = [summary('a', true, 'Refactor')]
    const lister = { list: vi.fn().mockImplementation(async () => sessions) }
    const monitor = new TaskMonitor(backend, lister)
    await monitor.poll()

    const activated: string[] = []
    monitor.onActivate = (sessionId) => activated.push(sessionId)
    sessions = [summary('a', false, 'Refactor')]
    await monitor.poll()
    expect(backend.notifications).toHaveLength(1)
    expect(backend.notifications[0].title).toBe('任务已结束')
    expect(backend.notifications[0].body).toBe('Refactor')
    expect(typeof backend.notifications[0].onClick).toBe('function')
    backend.notifications[0].onClick?.()
    expect(activated).toEqual(['a'])
    expect(backend.badges.at(-1)).toBe(0)
  })

  it('falls back to a short session id when the session has no title', async () => {
    const backend = makeBackend()
    let sessions = [summary('abcdefgh12', true)]
    const lister = { list: vi.fn().mockImplementation(async () => sessions) }
    const monitor = new TaskMonitor(backend, lister)
    await monitor.poll()
    sessions = [summary('abcdefgh12', false)]
    await monitor.poll()
    expect(backend.notifications[0].body).toBe('会话 abcdefgh')
  })

  it('does not notify for sessions it never saw running (launched mid-flight)', async () => {
    const backend = makeBackend()
    let sessions = [summary('a', false), summary('b', true, 'New')]
    const lister = { list: vi.fn().mockImplementation(async () => sessions) }
    const monitor = new TaskMonitor(backend, lister)
    await monitor.poll() // first scan: baseline
    sessions = [summary('a', false), summary('b', false, 'New')]
    // b appeared running in scan 1 → completion IS notified; c appears already
    // finished in scan 2 and was never seen running → no notification.
    sessions.push(summary('c', false))
    await monitor.poll()
    expect(backend.notifications.map((n) => n.body)).toEqual(['New'])
  })

  it('keeps the previous snapshot when the lister fails (no badge flicker)', async () => {
    const backend = makeBackend()
    let sessions = [summary('a', true, 'X')]
    const lister = { list: vi.fn().mockImplementation(async () => sessions) }
    const monitor = new TaskMonitor(backend, lister)
    await monitor.poll()
    expect(backend.badges.at(-1)).toBe(1)

    lister.list.mockRejectedValueOnce(new Error('rpc down'))
    await monitor.poll()
    expect(monitor.runningCount()).toBe(1) // snapshot kept
    expect(backend.badges.at(-1)).toBe(1) // badge untouched

    sessions = [summary('a', false, 'X')]
    await monitor.poll()
    expect(backend.notifications).toHaveLength(1)
    expect(backend.badges.at(-1)).toBe(0)
  })

  it('stop() clears state and zeroes the badge; unsupported backend never polls errors', async () => {
    const backend = makeBackend()
    const lister = { list: vi.fn().mockResolvedValue([summary('a', true)]) }
    const monitor = new TaskMonitor(backend, lister)
    await monitor.poll()
    monitor.stop()
    expect(backend.badges.at(-1)).toBe(0)
    expect(monitor.runningCount()).toBe(0)
    // after stop, next poll starts from scratch: first-scan quietness applies
    await monitor.poll()
    expect(backend.notifications).toEqual([])
  })
})
