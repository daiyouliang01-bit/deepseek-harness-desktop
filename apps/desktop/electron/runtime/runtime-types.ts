/** Task 1.2 — runtime process types (app-level, no Harness internals). */

import type { RuntimeDescriptor } from './dsh-bin'

export type RuntimeState =
  | 'idle' // not started
  | 'starting' // spawn issued, waiting for ready URL
  | 'ready' // ready URL parsed (and health probe passed)
  | 'stopping'
  | 'stopped'
  | 'error'

/**
 * Outcome of one `stop()` attempt (plan v1.4 residual gap: the old stop
 * reported success unconditionally, so a tree that survived SIGTERM+SIGKILL
 * was recorded as a clean stop and escaped next-launch reaping).
 *
 * - `'exited'` — the whole tree died (SIGTERM, or SIGKILL escalation).
 * - `'not-running'` — nothing owned was alive (already exited, or an adopted
 *   instance we deliberately do not kill).
 * - `'timeout'` — the tree SURVIVED both signals within the budget. The
 *   status moves to `error`, `onStopped(false)` records an unexpected exit so
 *   the ledger keeps the pid reapable, and the caller should surface a
 *   force-kill/log affordance instead of pretending all is well.
 */
export type StopOutcome = 'exited' | 'not-running' | 'timeout'

export interface ReadyInfo {
  /** Base URL of the official Harness Web UI, e.g. http://127.0.0.1:41234 */
  url: string
  /** The port actually bound by the server */
  port: number
  /** Startup time in ms */
  startupMs: number
}

export interface RuntimeStatus {
  state: RuntimeState
  pid?: number
  ready?: ReadyInfo
  lastError?: string
  startedAt?: number
}

export interface HarnessProcessOptions {
  /**
   * Resolved runtime descriptor (command + prefix args). When set, this is
   * used verbatim to spawn dsh. Takes precedence over `dshBin`.
   */
  runtime?: RuntimeDescriptor
  /** Path to the `dsh` executable (legacy; defaults to `dsh` on PATH). */
  dshBin?: string
  /** Extra args passed after `web` (e.g. `--trusted-host`). */
  extraArgs?: string[]
  /** Top-level dsh flags passed BEFORE the subcommand (e.g. `--patch`). */
  topLevelArgs?: string[]
  /** Timeout for the process to become ready (default 30s). */
  readyTimeoutMs?: number
  /** Whether to run the HTTP health probe after parsing the URL (default true). */
  healthProbe?: boolean
  /** Health probe timeout per attempt (default 2s). */
  healthProbeTimeoutMs?: number
  /** Poll interval between failed health probes (default 500ms). */
  healthProbeIntervalMs?: number
  /** Callback sink for captured stdout/stderr lines (for logs). */
  onOutput?: (stream: 'stdout' | 'stderr', line: string) => void
  /**
   * Extra environment variables merged into the spawned dsh's env (after
   * process.env). Tests use this to give each instance its own DSH_HOME so
   * parallel dsh processes never share the task-board ledger lock
   * (~/.dsh/task-board/ledger-v2.lock, single-instance by design).
   */
  env?: Record<string, string>
  /** Default: '--host 127.0.0.1 --port 0' (OS-assigned free port, ADR-007). */
  defaultArgs?: string[]
  /**
   * Preferred fixed port (Phase 2). When set, start() first checks the port
   * is free; if it is occupied by a healthy dsh the caller is expected to
   * reuse it (tryReuse) instead of spawning. Unset → --port 0 (OS-assigned).
   */
  port?: number
  /**
   * Auto-restart on unexpected exit (Phase 3.3, R9/R22). When true, a dsh
   * that dies outside a clean stop is restarted with exponential backoff
   * (1s→2s→4s… capped at 30s), giving up after `maxRestartAttempts`
   * consecutive fast crashes (default 5). User-initiated stop() disarms it.
   */
  autoRestart?: boolean
  maxRestartAttempts?: number
  /** Process-ledger callbacks (plan v1.4 §3.1): record spawn/ready/stop. */
  onSpawned?: (pid: number, startedAt: number) => void
  onReady?: (info: ReadyInfo) => void
  onStopped?: (clean: boolean) => void
}

export interface HarnessProcessEvents {
  statusChange: [status: RuntimeStatus]
}

/** Ready URL line format printed by `dsh web`: `dsh web: http://127.0.0.1:59853` */
export const READY_LINE_RE = /dsh web:\s+(https?:\/\/127\.0\.0\.1(?::(\d+))?[^\s]*)/i
