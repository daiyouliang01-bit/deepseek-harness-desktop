export { renderProjectSnapshot, snapshotProject } from './project-context'
export type { ProjectIo, ProjectSnapshot } from './project-context'
export { IllegalTaskTransition, TaskEngine } from './task-engine'
export { Verifier, detectLockfile, detectVerifyCommands, resolveNpmVerifyCommands, resolveVerifyCommands } from './verifier'
export type { VerifyKind, VerifyResult } from './verifier'
export { appendMemory, readMemory } from './memory'
export { HookRegistry } from './hooks'

export const CODING_AGENT_ID = 'coding-agent'
export const CODING_AGENT_VERSION = '0.1.0'

export type TaskPhase = 'idle' | 'planning' | 'working' | 'verifying' | 'completed' | 'failed'
export type HookName = 'beforeTool' | 'afterTool' | 'afterEdit' | 'beforeTask' | 'afterTask'

export interface CodingAgent {
  id: typeof CODING_AGENT_ID
  version: string
  projectContext: {
    snapshot(): null
  }
  taskEngine: {
    phase(): TaskPhase
  }
  verifier: {
    lastResult(): null
  }
  memory: {
    read(): string
  }
  hooks: {
    run(_name: HookName, _payload: unknown): void
  }
}

export function createCodingAgent(): CodingAgent {
  return {
    id: CODING_AGENT_ID,
    version: CODING_AGENT_VERSION,
    projectContext: {
      snapshot() {
        return null
      },
    },
    taskEngine: {
      phase() {
        return 'idle'
      },
    },
    verifier: {
      lastResult() {
        return null
      },
    },
    memory: {
      read() {
        return ''
      },
    },
    hooks: {
      run() {
        return undefined
      },
    },
  }
}
