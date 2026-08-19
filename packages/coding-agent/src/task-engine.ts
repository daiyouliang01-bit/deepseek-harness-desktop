import { renameSync } from 'node:fs'

export type TaskPhase = 'idle' | 'planning' | 'working' | 'verifying' | 'completed' | 'failed'

const LEGAL: Record<TaskPhase, readonly TaskPhase[]> = {
  idle: ['planning', 'working'],
  planning: ['working'],
  working: ['verifying'],
  verifying: ['working', 'completed', 'failed'],
  completed: ['idle'],
  failed: ['idle'],
}

export class IllegalTaskTransition extends Error {
  readonly from: TaskPhase
  readonly to: TaskPhase

  constructor(from: TaskPhase, to: TaskPhase) {
    super(`Illegal task transition: ${from} → ${to}`)
    this.name = 'IllegalTaskTransition'
    this.from = from
    this.to = to
  }
}

export class TaskEngine {
  #phase: TaskPhase = 'idle'

  phase(): TaskPhase {
    return this.#phase
  }

  transition(next: TaskPhase): void {
    if (!LEGAL[this.#phase].includes(next)) {
      throw new IllegalTaskTransition(this.#phase, next)
    }
    this.#phase = next
  }

  persist(path: string, write: (target: string, data: string) => void): void {
    const payload = JSON.stringify({
      version: 1,
      phase: this.#phase,
      updatedAt: Date.now(),
    })
    const tmp = `${path}.tmp`
    write(tmp, payload)
    renameSync(tmp, path)
  }

  restore(path: string, read: (target: string) => string | null): void {
    const raw = read(path)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; phase?: unknown }
      if (parsed.version !== 1) return
      if (typeof parsed.phase !== 'string' || !(parsed.phase in LEGAL)) return
      this.#phase = parsed.phase as TaskPhase
    } catch {
      /* corrupt file → stay idle */
    }
  }
}
