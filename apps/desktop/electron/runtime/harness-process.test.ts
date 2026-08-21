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

/**
 * A 200 response whose body carries the boot marker the health probe now
 * requires (identity check: only `dsh web` serves __DSH_BOOT__). Factory, not
 * a constant: a Response body can be consumed exactly once.
 */
const dshOkResponse = (): Response => new Response('<html>window.__DSH_BOOT__</html>', { status: 200 })

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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())

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

  it('keeps polling when the health probe fails, then resolves once the server is up', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('conn refused'))
      .mockResolvedValueOnce(dshOkResponse())

    const hp = new HarnessProcess({ healthProbeIntervalMs: 500 })
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:59853') // prints ONCE (real dsh prints it once)
    // first probe rejected — still starting
    await vi.advanceTimersByTimeAsync(10)
    expect(hp.getStatus().state).toBe('starting')
    // poll interval elapses → retry probe succeeds
    await vi.advanceTimersByTimeAsync(500)
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    fake.exitCode = 7
    fake.emit('exit', 7, null)
    expect(hp.getStatus().state).toBe('stopped')
    expect(hp.getStatus().lastError).toContain('code 7')
  })

  it('stop() kills the process tree (SIGTERM escalation) and settles stopped', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const hp = new HarnessProcess()
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    const stopPromise = hp.stop()
    // exit arrives after SIGTERM
    fake.exitCode = 0
    fake.emit('exit', 0, 'SIGTERM')
    const outcome = await stopPromise
    expect(outcome).toBe('exited')
    expect(hp.getStatus().state).toBe('stopped')
  })

  it('stop() returns not-running when nothing is owned', async () => {
    const hp = new HarnessProcess()
    expect(await hp.stop()).toBe('not-running')
  })

  it('stop() escalates to group SIGKILL and still reports exited when the child dies during grace', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const hp = new HarnessProcess()
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    // Child ignores SIGTERM entirely.
    const stopPromise = hp.stop(1_000)
    await vi.advanceTimersByTimeAsync(1_000) // SIGTERM budget elapsed
    // Escalation must already have been delivered synchronously.
    expect(process.kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
    // Child succumbs to SIGKILL during the grace window.
    fake.emit('exit', null, 'SIGKILL')
    expect(await stopPromise).toBe('exited')
    expect(hp.getStatus().state).toBe('stopped')
  })

  it('stop() returns timeout, marks error and reports UNCLEAN when the tree survives everything', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const onStopped = vi.fn()
    const hp = new HarnessProcess({ onStopped })
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    // Child ignores SIGTERM AND SIGKILL (the unkillable-tree scenario).
    const stopPromise = hp.stop(1_000)
    await vi.advanceTimersByTimeAsync(1_000) // SIGTERM budget elapsed → escalate
    expect(process.kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
    await vi.advanceTimersByTimeAsync(2_000) // kill grace elapsed → give up

    expect(await stopPromise).toBe('timeout')
    expect(hp.getStatus().state).toBe('error')
    expect(hp.getStatus().lastError).toContain('4242')
    expect(hp.getStatus().lastError).toContain('reaping')
    // Unclean report is what keeps the ledger entry reapable next launch.
    expect(onStopped).toHaveBeenCalledWith(false)
  })

  it('restart() stops the old child and starts a fresh one', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const hp = new HarnessProcess()
    const states: string[] = []
    hp.on('statusChange', (s) => states.push(s.state))
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise
    expect(states).toContain('starting')
    expect(states).toContain('ready')
  })

  it('spawns with detached:true on POSIX (R3 — own process group for tree kill)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const hp = new HarnessProcess()
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise
    const [, , opts] = spawnMock.mock.calls[0] as unknown as [string, string[], { detached?: boolean }]
    // vitest runs on the dev machine (darwin/linux); on win32 the app passes false
    if (process.platform !== 'win32') {
      expect(opts.detached).toBe(true)
    }
  })

  it('invokes ledger callbacks: onSpawned with pid+startedAt, onReady with info, onStopped(clean) on stop', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const spawned: Array<[number, number]> = []
    const readies: string[] = []
    const stopped: boolean[] = []
    const hp = new HarnessProcess({
      onSpawned: (pid, startedAt) => spawned.push([pid, startedAt]),
      onReady: (info) => readies.push(info.url),
      onStopped: (clean) => stopped.push(clean)
    })
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    expect(spawned).toHaveLength(1)
    expect(spawned[0][0]).toBe(4242)
    expect(spawned[0][1]).toBeGreaterThan(0)
    expect(readies).toEqual(['http://127.0.0.1:1234'])

    fake.exitCode = 0
    fake.emit('exit', 0, 'SIGTERM')
    await hp.stop()
    expect(stopped).toEqual([true])
  })

  it('invokes onStopped(false) on an unexpected exit after ready', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const stopped: boolean[] = []
    const hp = new HarnessProcess({ onStopped: (clean) => stopped.push(clean) })
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    fake.exitCode = 7
    fake.emit('exit', 7, null)
    expect(stopped).toEqual([false])
  })

  it('uses the fixed port when it is free (Phase 2.2)', async () => {
    // real timers: isPortFree() does real net I/O which fake timers never settle
    vi.useRealTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const { findFreePort } = await import('./port-probe')
    const port = (await findFreePort(49_400, 5)) as number

    const hp = new HarnessProcess({ port })
    const readyPromise = hp.start()
    // start() awaits isPortFree() before registering stdout listeners — wait
    // a tick so the listener is attached before we emit the ready line.
    await new Promise((r) => setTimeout(r, 50))
    emitStdout(`dsh web: http://127.0.0.1:${port}`)
    await readyPromise

    const [, args] = spawnMock.mock.calls[0] as unknown as [string, string[]]
    expect(args).toContain(String(port))
    vi.useFakeTimers()
  })

  it('falls back to a free port when the fixed port is occupied (R24)', async () => {
    vi.useRealTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    // occupy the preferred port
    const { createServer } = await import('node:net')
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(49_410, '127.0.0.1', () => resolve()))

    const hp = new HarnessProcess({ port: 49_410 })
    const readyPromise = hp.start()
    await new Promise((r) => setTimeout(r, 50))
    emitStdout('dsh web: http://127.0.0.1:49411')
    await readyPromise
    blocker.close()

    const [, args] = spawnMock.mock.calls[0] as unknown as [string, string[]]
    // must NOT use the blocked port; must carry a concrete port from the fallback
    expect(args).not.toContain('49410')
    const portIdx = args.indexOf('--port')
    expect(portIdx).toBeGreaterThan(-1)
    const fallback = Number(args[portIdx + 1])
    expect(fallback).toBeGreaterThan(0)
    expect(fallback).not.toBe(49_410)
    vi.useFakeTimers()
  })

  it('adopt() marks ready without spawning (Phase 2.3)', async () => {
    const hp = new HarnessProcess()
    const readies: string[] = []
    hp.on('statusChange', (s) => {
      if (s.state === 'ready' && s.ready) readies.push(s.ready.url)
    })
    hp.adopt({ url: 'http://127.0.0.1:35880', port: 35880, startupMs: 0 })
    expect(hp.getStatus().state).toBe('ready')
    expect(hp.getStatus().ready?.url).toBe('http://127.0.0.1:35880')
    expect(spawnMock).not.toHaveBeenCalled()
    expect(readies).toEqual(['http://127.0.0.1:35880'])
  })

  it('adopt() throws when already ready', () => {
    const hp = new HarnessProcess()
    hp.adopt({ url: 'http://127.0.0.1:1', port: 1, startupMs: 0 })
    expect(() => hp.adopt({ url: 'http://127.0.0.1:2', port: 2, startupMs: 0 })).toThrow(/already ready/)
  })

  it('auto-restarts after an unexpected exit (R9)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const hp = new HarnessProcess({ autoRestart: true })
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise
    expect(hp.getStatus().state).toBe('ready')

    // unexpected crash after ready
    fake.exitCode = 7
    fake.emit('exit', 7, null)
    expect(hp.getStatus().state).toBe('starting') // backoff phase

    // backoff elapses (fake timers) → start() is called again (new spawn)
    const fake2 = new FakeChild()
    fake2.pid = 8888
    spawnMock.mockReturnValueOnce(fake2 as unknown as ChildProcess)
    await vi.advanceTimersByTimeAsync(1_000)
    // new child emits ready
    ;(fake2.stdout as EventEmitter).emit('data', Buffer.from('dsh web: http://127.0.0.1:5678\n'))
    await vi.advanceTimersByTimeAsync(10)
    expect(hp.getStatus().state).toBe('ready')
    expect(hp.getStatus().ready?.url).toBe('http://127.0.0.1:5678')
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxRestartAttempts fast crashes (R22)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const hp = new HarnessProcess({ autoRestart: true, maxRestartAttempts: 2 })
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    // crash #1 → backoff → restart
    fake.exitCode = 7
    fake.emit('exit', 7, null)
    const fake2 = new FakeChild()
    fake2.pid = 9001
    spawnMock.mockReturnValueOnce(fake2 as unknown as ChildProcess)
    await vi.advanceTimersByTimeAsync(1_000)
    ;(fake2.stdout as EventEmitter).emit('data', Buffer.from('dsh web: http://127.0.0.1:2222\n'))
    await vi.advanceTimersByTimeAsync(10)
    expect(hp.getStatus().state).toBe('ready')

    // crash #2 → backoff → restart
    fake2.exitCode = 7
    fake2.emit('exit', 7, null)
    const fake3 = new FakeChild()
    fake3.pid = 9002
    spawnMock.mockReturnValueOnce(fake3 as unknown as ChildProcess)
    await vi.advanceTimersByTimeAsync(2_000)
    ;(fake3.stdout as EventEmitter).emit('data', Buffer.from('dsh web: http://127.0.0.1:3333\n'))
    await vi.advanceTimersByTimeAsync(10)
    expect(hp.getStatus().state).toBe('ready')

    // crash #3 → attempts exceed max (2) → give up
    fake3.exitCode = 7
    fake3.emit('exit', 7, null)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(hp.getStatus().state).toBe('error')
    expect(hp.getStatus().lastError).toContain('giving up')
    expect(spawnMock).toHaveBeenCalledTimes(3) // no 4th spawn
  })

  it('does NOT auto-restart after a user-initiated stop()', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const hp = new HarnessProcess({ autoRestart: true })
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    const stopPromise = hp.stop()
    fake.exitCode = 0
    fake.emit('exit', 0, 'SIGTERM') // clean exit during stop
    await stopPromise
    await vi.advanceTimersByTimeAsync(5_000)
    expect(hp.getStatus().state).toBe('stopped')
    expect(spawnMock).toHaveBeenCalledTimes(1) // no restart spawn
  })

  it('does NOT auto-restart on a clean exit (code 0)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => dshOkResponse())
    const hp = new HarnessProcess({ autoRestart: true })
    const readyPromise = hp.start()
    emitStdout('dsh web: http://127.0.0.1:1234')
    await readyPromise

    fake.exitCode = 0
    fake.emit('exit', 0, null)
    expect(hp.getStatus().state).toBe('stopped')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })
})
