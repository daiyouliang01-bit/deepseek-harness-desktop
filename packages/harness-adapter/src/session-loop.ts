import { join } from 'node:path'
import {
  detectLockfile,
  resolveVerifyCommands,
  TaskEngine,
  Verifier,
  type TaskPhase,
  type VerifyResult,
} from '@dshd/coding-agent'

const MUTATIONS = new Set(['write', 'edit', 'str_replace_editor'])

export type LoopPorts = {
  readText(path: string): Promise<string | null>
  writeFile(path: string, data: string): void
  runCommand(cmd: string): Promise<{ ok: boolean; output: string }>
  mkdirp(path: string): void
  /** Atomic rename (tmp → final). Falls back to writeFile when absent. */
  rename?(from: string, to: string): void
}

export function interpretCommandResult(raw: { isError?: boolean; content?: unknown }): { ok: boolean; output: string } {
  const output = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content ?? raw)
  if (raw.isError) return { ok: false, output }
  const match = output.match(/\[exit code:\s*(\d+)\]/)
  if (match && match[1] !== '0') return { ok: false, output }
  return { ok: true, output }
}

export function parsePersistedTask(raw: string): { phase: TaskPhase; verifyOk?: boolean } | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; phase?: unknown; lastVerify?: Array<{ ok?: unknown }> }
    if (parsed.version !== 1 || typeof parsed.phase !== 'string') return null
    const phase = parsed.phase as TaskPhase
    if (!['idle', 'planning', 'working', 'verifying', 'completed', 'failed'].includes(phase)) return null
    const lastVerify = parsed.lastVerify
    const verifyOk = Array.isArray(lastVerify) && lastVerify.length > 0 ? lastVerify.every((item) => item.ok === true) : undefined
    return { phase, verifyOk }
  } catch {
    return null
  }
}

export type LoopAction =
  | { type: 'none' }
  | { type: 'steer'; content: string }
  | { type: 'status'; phase: TaskPhase; lastVerify: Array<{ kind: string; ok: boolean }> | null }

type SessionState = {
  engine: TaskEngine
  verifier: Verifier
  dirty: boolean
  lastVerify: VerifyResult[] | null
}

export class SessionLoop {
  #sessions = new Map<string, SessionState>()
  #inflight = new Map<string, Promise<LoopAction>>()

  #state(sessionId: string): SessionState {
    let state = this.#sessions.get(sessionId)
    if (!state) {
      state = {
        engine: new TaskEngine(),
        verifier: new Verifier(async () => ({ ok: true, output: '' })),
        dirty: false,
        lastVerify: null,
      }
      this.#sessions.set(sessionId, state)
    }
    return state
  }

  /** Read-only view: never creates a session entry (view must not leak). */
  view(sessionId: string): { phase: TaskPhase; lastVerify: Array<{ kind: string; ok: boolean }> | null } {
    const state = this.#sessions.get(sessionId)
    if (!state) return { phase: 'idle', lastVerify: null }
    return { phase: state.engine.phase(), lastVerify: state.lastVerify }
  }

  /** Drop per-session state when the session ends (prevents leaks). */
  dispose(sessionId: string): void {
    this.#sessions.delete(sessionId)
    this.#inflight.delete(sessionId)
  }

  get sessionCount(): number {
    return this.#sessions.size
  }

  /** Start a fresh task cycle on a new user turn (completed/failed resets).
   *  The verifier's auto-fix budget also resets: a new task must not inherit
   *  the previous task's exhausted attempts. */
  #startTask(state: SessionState): void {
    const phase = state.engine.phase()
    if (phase === 'idle') {
      state.engine.transition('working')
      return
    }
    if (phase === 'completed' || phase === 'failed') {
      state.engine.transition('idle')
      state.engine.transition('working')
      state.verifier = new Verifier(async () => ({ ok: true, output: '' }))
    }
  }

  noteUserTurn(sessionId: string): LoopAction {
    const state = this.#state(sessionId)
    try {
      this.#startTask(state)
    } catch {
      return { type: 'none' }
    }
    return { type: 'status', phase: state.engine.phase(), lastVerify: state.lastVerify }
  }

  noteMutation(sessionId: string, toolName: string): LoopAction {
    if (!MUTATIONS.has(toolName)) return { type: 'none' }
    const state = this.#state(sessionId)
    try {
      this.#startTask(state)
    } catch {
      /* keep going */
    }
    state.dirty = true
    return { type: 'status', phase: state.engine.phase(), lastVerify: state.lastVerify }
  }

  async finishTurn(sessionId: string, cwd: string | undefined, ports: LoopPorts): Promise<LoopAction> {
    const state = this.#state(sessionId)
    if (!state.dirty || !cwd) return { type: 'none' }
    // Re-entrancy guard: both session/event (turn/end) and the turn/end
    // event may fire for the same turn end; only one verify may run.
    const inflight = this.#inflight.get(sessionId)
    if (inflight) return inflight
    const run = this.#finishTurn(sessionId, cwd, state, ports)
    this.#inflight.set(sessionId, run)
    try {
      return await run
    } finally {
      this.#inflight.delete(sessionId)
    }
  }

  async #finishTurn(sessionId: string, cwd: string, state: SessionState, ports: LoopPorts): Promise<LoopAction> {
    let pkgText: string | null
    let scripts: Record<string, string> | undefined
    try {
      const [pkg, pnpmLock, yarnLock] = await Promise.all([
        ports.readText(join(cwd, 'package.json')),
        ports.readText(join(cwd, 'pnpm-lock.yaml')),
        ports.readText(join(cwd, 'yarn.lock')),
      ])
      pkgText = pkg
      if (pkgText) {
        try {
          scripts = (JSON.parse(pkgText) as { scripts?: Record<string, string> }).scripts
        } catch {
          return { type: 'none' }
        }
      }
      const lockfile = detectLockfile([pnpmLock ? 'pnpm-lock.yaml' : undefined, yarnLock ? 'yarn.lock' : undefined])
      const cmds = resolveVerifyCommands(scripts, lockfile)
      if (Object.keys(cmds).length === 0) {
        state.dirty = false
        return { type: 'none' }
      }
      try {
        if (state.engine.phase() === 'working') state.engine.transition('verifying')
      } catch {
        return { type: 'none' }
      }
      const verifier = new Verifier((cmd) => ports.runCommand(cmd))
      verifier.autoFixAttempts = state.verifier.autoFixAttempts
      let results: VerifyResult[]
      try {
        results = await verifier.runAll(cmds)
      } catch {
        return { type: 'none' }
      }
      state.verifier = verifier
      state.lastVerify = results
      state.dirty = false
      const ok = results.every((item) => item.ok)
      try {
        if (ok) state.engine.transition('completed')
        else if (verifier.tryAutoFix()) state.engine.transition('working')
        else state.engine.transition('failed')
      } catch {
        return { type: 'none' }
      }
      this.#persist(sessionId, cwd, state, ports)
      if (!ok && state.engine.phase() === 'working') {
        return {
          type: 'steer',
          content: [
            '验证失败，请修复原始失败项后停止。',
            ...results.filter((item) => !item.ok).map((item) => `【${item.kind}】${item.command}\n${item.output}`),
          ].join('\n\n'),
        }
      }
      return { type: 'status', phase: state.engine.phase(), lastVerify: state.lastVerify }
    } catch {
      return { type: 'none' }
    }
  }

  #persist(sessionId: string, cwd: string, state: SessionState, ports: LoopPorts): void {
    try {
      const dir = join(cwd, '.dsh', 'tasks')
      ports.mkdirp(dir)
      const target = join(dir, `${sessionId}.json`)
      const payload = JSON.stringify({
        version: 1,
        phase: state.engine.phase(),
        updatedAt: Date.now(),
        lastVerify: state.lastVerify,
      })
      if (ports.rename) {
        const tmp = `${target}.tmp`
        ports.writeFile(tmp, payload)
        ports.rename(tmp, target)
      } else {
        ports.writeFile(target, payload)
      }
    } catch {
      /* persist must not throw */
    }
  }
}
