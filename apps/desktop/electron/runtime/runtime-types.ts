/** Task 1.2 — runtime process types (app-level, no Harness internals). */

export type RuntimeState =
  | 'idle' // not started
  | 'starting' // spawn issued, waiting for ready URL
  | 'ready' // ready URL parsed (and health probe passed)
  | 'stopping'
  | 'stopped'
  | 'error'

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
  /** Path to the `dsh` executable (defaults to `dsh` on PATH). */
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
  /** Default: '--host 127.0.0.1 --port 0' (OS-assigned free port, ADR-007). */
  defaultArgs?: string[]
}

export interface HarnessProcessEvents {
  statusChange: [status: RuntimeStatus]
}

/** Ready URL line format printed by `dsh web`: `dsh web: http://127.0.0.1:59853` */
export const READY_LINE_RE = /dsh web:\s+(https?:\/\/127\.0\.0\.1(?::(\d+))?[^\s]*)/i
