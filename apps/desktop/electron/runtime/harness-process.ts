/** Task 1.2 — Harness process manager (spawns pinned `dsh web` on 127.0.0.1). */

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  READY_LINE_RE,
  type HarnessProcessEvents,
  type HarnessProcessOptions,
  type ReadyInfo,
  type RuntimeState,
  type RuntimeStatus
} from './runtime-types'

const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 2_000
const DEFAULT_ARGS = ['--host', '127.0.0.1', '--port', '0']

export class HarnessProcess extends EventEmitter<HarnessProcessEvents> {
  private readonly options: Required<HarnessProcessOptions> & { defaultArgs: string[] }
  private child: ChildProcess | null = null
  private status: RuntimeStatus = { state: 'idle' }
  private readyResolve: ((info: ReadyInfo) => void) | null = null
  private readyReject: ((err: Error) => void) | null = null
  private readyTimer: NodeJS.Timeout | null = null
  private readonly output: { stdout: string; stderr: string } = { stdout: '', stderr: '' }
  private readonly startedAt: number | null = null

  constructor(options: HarnessProcessOptions = {}) {
    super()
    this.options = {
      dshBin: options.dshBin ?? 'dsh',
      extraArgs: options.extraArgs ?? [],
      readyTimeoutMs: options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      healthProbe: options.healthProbe ?? true,
      healthProbeTimeoutMs: options.healthProbeTimeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
      onOutput: options.onOutput ?? (() => undefined),
      defaultArgs: options.defaultArgs ?? DEFAULT_ARGS
    }
  }

  getStatus(): RuntimeStatus {
    return this.status
  }

  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null
  }

  /** Spawn the pinned `dsh web` and wait until it reports ready. */
  async start(): Promise<ReadyInfo> {
    if (this.isRunning()) throw new Error('runtime already running')

    const { dshBin, extraArgs, defaultArgs } = this.options
    const args = ['web', ...defaultArgs, ...extraArgs]

    this.setStatus('starting')
    const child = spawn(dshBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    if (child.pid) this.status = { ...this.status, pid: child.pid }

    child.stdout?.on('data', (chunk: Buffer) => this.handleOutput('stdout', chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => this.handleOutput('stderr', chunk.toString()))
    child.on('error', (err) => this.handleExit(err))
    child.on('exit', (code, signal) => this.handleExit(undefined, code, signal))

    const ready = new Promise<ReadyInfo>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })

    // Startup timeout
    this.readyTimer = setTimeout(() => {
      this.fail(new Error(`runtime did not become ready within ${this.options.readyTimeoutMs}ms`))
    }, this.options.readyTimeoutMs)

    return ready
  }

  /** Wait for readiness (no-op if already ready). */
  async waitUntilReady(timeoutMs?: number): Promise<ReadyInfo> {
    if (this.status.state === 'ready' && this.status.ready) return this.status.ready
    const ready = new Promise<ReadyInfo>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    const timer = timeoutMs
      ? setTimeout(() => {
          this.fail(new Error(`runtime did not become ready within ${timeoutMs}ms`))
        }, timeoutMs)
      : null
    try {
      return await ready
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private handleOutput(stream: 'stdout' | 'stderr', text: string): void {
    this.output[stream] += text
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      this.options.onOutput(stream, line)
      const m = READY_LINE_RE.exec(line)
      if (m) void this.tryReady(m)
    }
  }

  private async tryReady(m: RegExpExecArray): Promise<void> {
    const port = m[2] ? Number(m[2]) : 0
    const url = m[1]
    if (this.status.state !== 'starting') return

    if (this.options.healthProbe) {
      const ok = await this.probeHealth(url)
      if (!ok) return // keep waiting; the server may not have bound yet
    }
    this.markReady(url, port)
  }

  private async probeHealth(url: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.options.healthProbeTimeoutMs)
      try {
        const res = await fetch(url, { signal: controller.signal })
        return res.ok || res.status >= 400 // any HTTP answer means the server is up
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return false
    }
  }

  private markReady(url: string, port: number): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
    const info: ReadyInfo = {
      url,
      port,
      startupMs: Date.now() - (this.status.startedAt ?? Date.now())
    }
    this.setStatus('ready', { ready: info })
    this.readyResolve?.(info)
    this.readyResolve = null
    this.readyReject = null
  }

  private fail(err: Error): void {
    this.setStatus('error', { lastError: err.message })
    this.readyReject?.(err)
    this.readyResolve = null
    this.readyReject = null
  }

  private handleExit(err?: Error, code?: number | null, signal?: string | null): void {
    if (this.child) this.child = null
    if (this.status.state === 'starting') {
      const msg = err?.message ?? `dsh exited before ready (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      this.fail(new Error(msg))
      return
    }
    this.setStatus('stopped', {
      lastError:
        code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL'
          ? undefined
          : `dsh exited with code ${code ?? signal}`
    })
  }

  /** Stop the child process, killing the full process tree. */
  async stop(timeoutMs = 5_000): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null) {
      this.setStatus('stopped')
      return
    }
    this.setStatus('stopping')
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    })
    this.killTree(child)
    await Promise.race([exited, new Promise((r) => setTimeout(r, timeoutMs))])
    this.setStatus('stopped')
  }

  /** Restart: stop the current process (if any) and start a fresh one. */
  async restart(): Promise<ReadyInfo> {
    await this.stop()
    this.output.stdout = ''
    this.output.stderr = ''
    return this.start()
  }

  /**
   * Kill the child and its descendants. POSIX: SIGTERM, escalate to SIGKILL
   * after a grace period. Windows: taskkill /T /F (tree kill).
   */
  private killTree(child: ChildProcess): void {
    const pid = child.pid
    if (!pid) return
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      return
    }
    try {
      process.kill(-pid, 'SIGTERM') // negative pid = process group
    } catch {
      child.kill('SIGTERM')
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }, 2_000).unref()
  }

  private setStatus(state: RuntimeState, extra: Partial<RuntimeStatus> = {}): void {
    const previous = this.status
    this.status = {
      ...this.status,
      ...extra,
      state,
      startedAt: this.status.startedAt ?? (state === 'starting' ? Date.now() : undefined)
    }
    if (previous.state !== state || JSON.stringify(previous.ready) !== JSON.stringify(this.status.ready)) {
      this.emit('statusChange', this.status)
    }
  }
}
