/** Task 1.2 — Harness process manager (spawns pinned `dsh web` on 127.0.0.1). */

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { isPortFree, findFreePort } from './port-probe'
import type { RuntimeDescriptor } from './dsh-bin'
import {
  READY_LINE_RE,
  type HarnessProcessEvents,
  type HarnessProcessOptions,
  type ReadyInfo,
  type RuntimeState,
  type RuntimeStatus,
  type StopOutcome
} from './runtime-types'

const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 2_000
const DEFAULT_HEALTH_PROBE_INTERVAL_MS = 500
const DEFAULT_ARGS = ['--host', '127.0.0.1', '--port', '0']
const DEFAULT_MAX_RESTART_ATTEMPTS = 5
const RESTART_BACKOFF_BASE_MS = 1_000
const RESTART_BACKOFF_CAP_MS = 30_000
/** A crash within this window after ready counts as a "fast crash" (R22). */
const FAST_CRASH_WINDOW_MS = 30_000
/**
 * Grace granted to SIGKILL escalation inside stop() after the SIGTERM budget
 * elapsed. Mirrors killTree's internal delay so the two paths stay consistent.
 */
const KILL_GRACE_MS = 2_000
/**
 * Marker injected by `dsh web` into the shell HTML (the documented
 * client-modules boot contract). Its presence in a 2xx response is the
 * health probe's identity check: only the real runtime serves it.
 */
const DSH_BOOT_MARKER = '__DSH_BOOT__'

export class HarnessProcess extends EventEmitter<HarnessProcessEvents> {
  private readonly options: Omit<Required<HarnessProcessOptions>, 'port' | 'runtime' | 'dshBin'> & {
    port?: number
    runtime: RuntimeDescriptor
    defaultArgs: string[]
  }
  private child: ChildProcess | null = null
  private status: RuntimeStatus = { state: 'idle' }
  private readyResolve: ((info: ReadyInfo) => void) | null = null
  private readyReject: ((err: Error) => void) | null = null
  private readyTimer: NodeJS.Timeout | null = null
  private readonly output: { stdout: string; stderr: string } = { stdout: '', stderr: '' }
  private readonly startedAt: number | null = null
  // Phase 3.3 (R9/R22): auto-restart state
  private autoRestartArmed = false
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private lastReadyAt = 0

  constructor(options: HarnessProcessOptions = {}) {
    super()
    this.options = {
      runtime: options.runtime ?? { command: options.dshBin ?? 'dsh', prefixArgs: [], label: options.dshBin ?? 'dsh' },
      extraArgs: options.extraArgs ?? [],
      topLevelArgs: options.topLevelArgs ?? [],
      readyTimeoutMs: options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      healthProbe: options.healthProbe ?? true,
      healthProbeTimeoutMs: options.healthProbeTimeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
      healthProbeIntervalMs: options.healthProbeIntervalMs ?? DEFAULT_HEALTH_PROBE_INTERVAL_MS,
      onOutput: options.onOutput ?? (() => undefined),
      onSpawned: options.onSpawned ?? (() => undefined),
      onReady: options.onReady ?? (() => undefined),
      onStopped: options.onStopped ?? (() => undefined),
      env: options.env ?? {},
      port: options.port,
      autoRestart: options.autoRestart ?? false,
      maxRestartAttempts: options.maxRestartAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS,
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

    // Phase 2.2 (R24): fixed-port preference with a full fallback chain.
    //   fixed port free            → use it
    //   fixed port occupied        → caller should have reused (tryReuse);
    //                                if we get here, fall back to a free port
    //   findFreePort exhausted     → --port 0 (OS-assigned, never fails)
    const { runtime, extraArgs, defaultArgs, topLevelArgs, port } = this.options
    let portArgs = defaultArgs
    if (port !== undefined) {
      if (await isPortFree(port)) {
        portArgs = ['--host', '127.0.0.1', '--port', String(port)]
      } else {
        const free = await findFreePort()
        portArgs = free !== null ? ['--host', '127.0.0.1', '--port', String(free)] : DEFAULT_ARGS
      }
    }

    // Top-level flags (--patch/--profile) must precede the subcommand; the
    // `web` alias refuses parent flags, so use `--profile web` when we have
    // top-level args, and the plain `web` alias otherwise.
    const args = topLevelArgs.length > 0
      ? [...topLevelArgs, '--profile', 'web', ...portArgs, ...extraArgs]
      : ['web', ...portArgs, ...extraArgs]

    // Resolve the actual bound port from the spawn args so in-process plugins
    // (e.g. @dshd/phone-sync tunnel) can learn their own upstream URL without
    // hard-coding 3080. Falls back to 0 (unknown) for the --port 0 path.
    const portIdx = portArgs.indexOf('--port')
    const boundPort = portIdx >= 0 ? Number(portArgs[portIdx + 1]) : 0
    const childEnv = { ...process.env, ...this.options.env, DSH_APP_PORT: String(boundPort) }

    // R3: detached:true gives the child its own process group so killTree can
    // kill the WHOLE tree via kill(-pid); without it kill(-pid) throws ESRCH
    // and only the direct child dies, orphaning grandchildren.
    const startedAt = Date.now()
    this.setStatus('starting')
    // Bundled runtime: spawn <node> <bin.js> <dsh args...>. PATH runtime:
    // spawn <dsh> <dsh args...> (prefixArgs empty).
    const child = spawn(runtime.command, [...runtime.prefixArgs, ...args], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: childEnv })
    this.child = child
    if (child.pid) this.status = { ...this.status, pid: child.pid }
    this.options.onSpawned?.(child.pid ?? 0, startedAt)

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

  /**
   * Adopt an already-running dsh instance (Phase 2.3 tryReuse) without
   * spawning. Marks the runtime ready at the given URL and notifies the
   * ledger via onReady. The adopted instance is NOT owned as a child process
   * (stop() is a no-op for it) — ownership is tracked in the ledger as
   * `adopted: true` so the next launch reuses it instead of killing it.
   */
  adopt(info: ReadyInfo): void {
    if (this.status.state === 'ready') throw new Error('runtime already ready')
    this.setStatus('ready', { ready: info, pid: undefined })
    this.options.onReady?.(info)
  }

  private handleOutput(stream: 'stdout' | 'stderr', text: string): void {
    this.output[stream] += text
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      this.options.onOutput(stream, line)
      const m = READY_LINE_RE.exec(line)
      if (m) this.startReadyPolling(m)
    }
  }

  private pendingReady: { url: string; port: number } | null = null
  private polling = false

  /**
   * The ready URL line prints just before the server finishes binding, so a
   * single health probe can race the socket. Poll until the server answers
   * (bounded by the startup timeout, which fails the start on expiry).
   */
  private startReadyPolling(m: RegExpExecArray): void {
    if (this.status.state !== 'starting') return
    this.pendingReady = {
      url: m[1],
      port: m[2] ? Number(m[2]) : 0
    }
    if (!this.polling) void this.pollHealth()
  }

  private async pollHealth(): Promise<void> {
    this.polling = true
    let attempt = 0
    while (this.pendingReady && this.status.state === 'starting') {
      const { url, port } = this.pendingReady
      attempt++
      const ok = this.options.healthProbe ? await this.probeHealth(url) : true
      if (ok) {
        this.pendingReady = null
        this.polling = false
        this.markReady(url, port)
        return
      }
      this.options.onOutput('stdout', `[health-probe] not up yet, retrying ${url} (attempt ${attempt})`)
      await new Promise((r) => setTimeout(r, this.options.healthProbeIntervalMs))
    }
    this.polling = false
  }

  private async probeHealth(url: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.options.healthProbeTimeoutMs)
      try {
        const res = await fetch(url, { signal: controller.signal })
        // Identity check, not just liveness: a ready dsh answers 2xx AND its
        // shell HTML carries the boot marker that only `dsh web` injects.
        // The old check accepted ANY HTTP answer including >=400, so a foreign
        // service squatting on the port was misidentified as the runtime.
        // False negatives here merely keep polling until the startup timeout,
        // so tightening is safe.
        if (!res.ok) return false
        const body = await res.text()
        return body.includes(DSH_BOOT_MARKER)
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
    this.options.onReady?.(info)
    this.readyResolve?.(info)
    this.readyResolve = null
    this.readyReject = null
    // armAutoRestart reads lastReadyAt to decide whether the counter resets —
    // so arm BEFORE updating lastReadyAt.
    this.armAutoRestart()
    this.lastReadyAt = Date.now()
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
      this.options.onStopped?.(false)
      return
    }
    const clean = code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL'
    this.setStatus('stopped', {
      lastError:
        clean
          ? undefined
          : `dsh exited with code ${code ?? signal}`
    })
    this.options.onStopped?.(clean)

    // Phase 3.3 (R9): auto-restart on UNEXPECTED exit, unless the user asked
    // us to stop or we are shutting down.
    if (this.options.autoRestart && !clean && this.autoRestartArmed) {
      this.scheduleRestart()
    }
  }

  /** Phase 3.3: schedule an auto-restart with exponential backoff (R9/R22). */
  private scheduleRestart(): void {
    if (this.restartTimer) return
    const fastCrash = Date.now() - this.lastReadyAt < FAST_CRASH_WINDOW_MS
    this.restartAttempts += 1
    if (fastCrash && this.restartAttempts > this.options.maxRestartAttempts) {
      // R22: give up after consecutive fast crashes — surface an error instead
      // of looping forever.
      this.autoRestartArmed = false
      this.setStatus('error', { lastError: `dsh crashed ${this.restartAttempts} times in a row; giving up auto-restart` })
      this.options.onStopped?.(false)
      return
    }
    const backoff = Math.min(RESTART_BACKOFF_BASE_MS * 2 ** (this.restartAttempts - 1), RESTART_BACKOFF_CAP_MS)
    this.setStatus('starting', { lastError: `restarting in ${backoff}ms (attempt ${this.restartAttempts})` })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.autoRestartArmed) return // disarmed (user stop / quit) meanwhile
      void this.start().catch(() => {
        /* status already reflects the failure */
      })
    }, backoff)
  }

  /** Phase 3.3: arm auto-restart (called after a successful start). */
  private armAutoRestart(): void {
    this.autoRestartArmed = true
    // Reset the fast-crash counter only when the runtime has been stable long
    // enough that this ready is clearly NOT part of a crash loop (R22).
    if (this.lastReadyAt > 0 && Date.now() - this.lastReadyAt > FAST_CRASH_WINDOW_MS) {
      this.restartAttempts = 0
    }
  }

  /**
   * Stop the child process, killing the full process tree.
   *
   * Returns a {@link StopOutcome} so callers can distinguish a verified death
   * from a survivor (plan v1.4 residual gap): on `'timeout'` the status moves
   * to `error` and `onStopped(false)` records an unexpected exit, keeping the
   * pid in the ledger for next-launch reaping — the old code reported clean
   * unconditionally, which let an unkillable tree escape reaping forever.
   */
  async stop(timeoutMs = 5_000): Promise<StopOutcome> {
    // Disarm auto-restart BEFORE killing: handleExit fires during stop and
    // must not schedule a restart (user asked us to stop).
    this.autoRestartArmed = false
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    if (!child || child.exitCode !== null) {
      // Adopted runtimes land here too (never owned as a child): nothing to
      // kill, and the ledger's adopted flag keeps them reusable next launch.
      if (this.status.state !== 'stopped') {
        this.setStatus('stopped')
        this.options.onStopped?.(true)
      }
      return 'not-running'
    }
    const pid = child.pid
    this.setStatus('stopping')
    const exited = new Promise<boolean>((resolve) => {
      child.once('exit', () => resolve(true))
    })
    const sleep = (ms: number) => new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))
    this.killTree(child)
    let died = await Promise.race([exited, sleep(timeoutMs)])
    if (!died && pid) {
      // SIGTERM budget elapsed → escalate NOW. killTree's internal SIGKILL
      // timer is .unref()'d, so it would never fire if the app quits first;
      // delivering it synchronously here is what makes the quit path able to
      // guarantee "no orphan outlives the app" (G1 residual).
      this.escalateKill(pid)
      died = await Promise.race([exited, sleep(KILL_GRACE_MS)])
    }
    if (!died) {
      // Survivor: do NOT report clean. The ledger must treat this as an
      // unexpected exit so reapBeforeSpawn() triple-checks and reaps the tree
      // on the next launch instead of trusting a "clean stop" that never was.
      this.setStatus('error', {
        lastError: `dsh (pid ${pid ?? '?'}) survived SIGTERM+SIGKILL; recorded for reaping on next launch`
      })
      this.options.onStopped?.(false)
      return 'timeout'
    }
    // handleExit already settled 'stopped' via the exit event; settle here too
    // for the edge where the event was coalesced, without double-reporting.
    if (this.status.state === 'stopping') {
      this.setStatus('stopped')
      this.options.onStopped?.(true)
    }
    return 'exited'
  }

  /**
   * Immediate group SIGKILL, used by stop() when the SIGTERM budget elapses.
   * Falls back to killing just the direct child when the group is gone.
   */
  private escalateKill(pid: number): void {
    if (process.platform === 'win32') return // taskkill /T /F already forceful
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        this.child?.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
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
