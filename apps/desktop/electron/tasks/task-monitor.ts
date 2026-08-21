/** P1 slice — task-center watch: subagent/task completion notifications + Dock badge. */

import type { SessionSummary } from '../adapter/session-adapter'

/**
 * TaskMonitor — the desktop shell's eyes on background work.
 *
 * Polls the runtime's session list and reacts to per-session `running`
 * transitions:
 *   - running → idle : system notification "任务已结束" (click focuses the app)
 *   - badge          : Dock badge = number of currently running sessions
 *
 * Deliberately notification-quiet on the first scan (the app just started —
 * everything it sees is old news) and on sessions it never saw running
 * (the user launched those moments ago). Failure vs. success distinction
 * needs task-board phase data and is deferred to a later slice; the wording
 * is intentionally neutral ("已结束", not "成功").
 */
export interface TaskMonitorBackend {
  notify: (title: string, body: string, onClick?: () => void) => void
  setBadge: (count: number) => void
  isSupported: () => boolean
}

export interface TaskStatus {
  phase?: string
  verifyOk?: boolean
}

export interface TaskLister {
  list: () => Promise<SessionSummary[]>
  /**
   * Optional task-sidecar lookup (.dsh/tasks/<id>.json). When it reports
   * phase 'failed' or lastVerify all-failed, the notification says 任务失败
   * instead of the neutral 任务已结束; null/unknown keeps neutral wording.
   */
  taskStatus?: (sessionId: string) => Promise<TaskStatus | null>
}

export const DEFAULT_TASK_POLL_MS = 10_000

export class TaskMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  /** Sessions observed running as of the last scan: sessionId → title. */
  private running = new Map<string, string | undefined>()
  private firstScanDone = false
  private pollInFlight = false

  constructor(
    private readonly backend: TaskMonitorBackend,
    private readonly lister: TaskLister,
    private readonly pollMs: number = DEFAULT_TASK_POLL_MS
  ) {}

  start(): void {
    if (this.timer) return
    void this.poll()
    this.timer = setInterval(() => void this.poll(), this.pollMs)
  }

  /** Stop polling and clear the badge; forget tracked sessions. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.running.clear()
    this.firstScanDone = false
    this.backend.setBadge(0)
  }

  runningCount(): number {
    return this.running.size
  }

  async poll(): Promise<void> {
    if (this.pollInFlight) return
    this.pollInFlight = true
    try {
      if (!this.backend.isSupported()) return
      const sessions = await this.lister.list()
      const now = new Map<string, string | undefined>()
      let badge = 0
      for (const s of sessions) {
        if (!s.running) continue
        badge += 1
        now.set(s.sessionId, s.title)
      }
      if (this.firstScanDone) {
        for (const [sessionId, title] of this.running) {
          if (now.has(sessionId)) continue
          const label = title ?? `会话 ${sessionId.slice(0, 8)}`
          const status = this.lister.taskStatus ? await this.lister.taskStatus(sessionId).catch(() => null) : null
          const failed = status?.phase === 'failed' || status?.verifyOk === false
          const body = `${failed ? '✗ ' : ''}${label}`
          this.backend.notify(failed ? '任务失败' : '任务完成', body, () => this.onActivate?.(sessionId))
        }
      }
      this.running = now
      this.firstScanDone = true
      this.backend.setBadge(badge)
    } catch {
      // Runtime not ready / RPC hiccup: keep the previous snapshot and let
      // the next tick retry. Clearing the badge here would flicker it on
      // every transient failure.
    } finally {
      this.pollInFlight = false
    }
  }

  /** Optional hook: invoked on notification click with the finished session id. */
  onActivate?: (sessionId: string) => void
}
