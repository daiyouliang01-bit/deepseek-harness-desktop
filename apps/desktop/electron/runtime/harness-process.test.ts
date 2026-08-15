import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HarnessProcess } from './harness-process'
import type { ChildProcess } from 'node:child_process'

/** Fake ChildProcess that we can drive manually. */
class FakeChild extends EventEmitter {
  pid = 4242
  exitCode: number | null = null
  signalCode: string | null = null
  killed = false
  stdout = new EventEmitter() as unknown as NodeJS.ReadableStream
  stderr = new EventEmitter() as unknown as NodeJS.ReadableStream
  kill = vi.fn(() => {
    this.killed = true
    return true
  })
}

vi.mock('node:child_process', () => {
  const actual = vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawn: vi.fn()
  }
})

import { spawn } from 'node:child_process'

const spawnMock = vi.mocked(spawn)

describe('HarnessProcess (fake child)', () => {
  let fake: FakeChild

  beforeEach(() => {
    fake = new FakeChild()
    spawnMock.mockReset()
    spawnMock.mockReturnValue(fake as unknown as ChildProcess)
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function emitStdout(line: string): void {
    ;(fake.stdout as EventEmitter).emit('data', Buffer.from(line + '\n'))
  }

  it('resolves ready when the ready URL line is printed and health probe passes', async () => {
    // health probe: any HTTP answer counts as up
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))

    const hp = new HarnessProcess()
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:59853')
    const info = await readyPromise

    expect(info.url).toBe('http://127.0.0.1:59853')
    expect(info.port).toBe(59853)
    expect(hp.getStatus().state).toBe('ready')
    expect(spawnMock).toHaveBeenCalledWith(
      'dsh',
      ['web', '--host', '127.0.0.1', '--port', '0'],
      expect.anything()
    )
  })

  it('keeps waiting when the health probe fails, then resolves once it succeeds', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('conn refused'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))

    const hp = new HarnessProcess()
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:59853')
    // first probe rejected — still starting
    await vi.advanceTimersByTimeAsync(10)
    expect(hp.getStatus().state).toBe('starting')
    emitStdout('dsh web: http://127.0.0.1:59853') // second line triggers retry
    const info = await readyPromise
    expect(info.port).toBe(59853)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects with a timeout error when no ready line arrives', async () => {
    const hp = new HarnessProcess({ readyTimeoutMs: 5_000 })
    const readyPromise = hp.start()
    const rejection = expect(readyPromise).rejects.toThrow(/did not become ready/)
    await vi.advanceTimersByTimeAsync(5_100)
    await rejection
    expect(hp.getStatus().state).toBe('error')
  })

  it('rejects when the child exits before ready (non-zero exit)', async () => {
    const hp = new HarnessProcess()
    const readyPromise = hp.start()
    fake.exitCode = 1
    fake.emit('exit', 1, null)
    await expect(readyPromise).rejects.toThrow(/exited before ready/)
    expect(hp.getStatus().state).toBe('error')
  })

  it('marks stopped with error info on a non-zero exit after ready', async () => {
    const hp = new HarnessProcess()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    fake.exitCode = 7
    fake.emit('exit', 7, null)
    expect(hp.getStatus().state).toBe('stopped')
    expect(hp.getStatus().lastError).toContain('code 7')
  })

  it('stop() kills the process tree (SIGTERM escalation) and settles stopped', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const hp = new HarnessProcess()
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    const stopPromise = hp.stop()
    // exit arrives after SIGTERM
    fake.exitCode = 0
    fake.emit('exit', 0, 'SIGTERM')
    await stopPromise
    expect(hp.getStatus().state).toBe('stopped')
  })

  it('restart() stops the old child and starts a fresh one', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const hp = new HarnessProcess()
    const p1 = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await p1

    fake.exitCode = 0
    fake.emit('exit', 0, 'SIGTERM')
    const fake2 = new FakeChild()
    fake2.pid = 7777
    spawnMock.mockReturnValueOnce(fake2 as unknown as ChildProcess)

    const p2 = hp.restart()
    // restart() awaits stop() first — let the microtask run so start() has
    // registered the new child's stdout listener before we emit data.
    await vi.advanceTimersByTimeAsync(0)
    ;(fake2.stdout as EventEmitter).emit('data', Buffer.from('dsh web: http://127.0.0.1:9999\n'))
    const info2 = await p2
    expect(info2.port).toBe(9999)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('emits statusChange events', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const hp = new HarnessProcess()
    const states: string[] = []
    hp.on('statusChange', (s) => states.push(s.state))
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise
    expect(states).toContain('starting')
    expect(states).toContain('ready')
  })
})
