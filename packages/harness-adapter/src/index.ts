import type { CodingAgent, TaskPhase } from '@dshd/coding-agent'

export { prepareProjectContextMessage } from './process-bridge'
export type { PreStepInput, SnapshotPorts } from './process-bridge'
export { interpretCommandResult, parsePersistedTask, SessionLoop } from './session-loop'
export type { LoopAction, LoopPorts } from './session-loop'

export const PROCESS_PLUGIN_ID = 'coding-agent'

export type DesktopCodingEvent =
  | { type: 'task-updated'; phase: TaskPhase }
  | { type: 'verify-finished'; ok: boolean }
  | { type: 'project-context-ready' }

export type CodingAgentView = {
  phase: TaskPhase | string
  lastVerify?: Array<{ kind: string; ok: boolean }> | null
}

function asView(input: CodingAgent | CodingAgentView): CodingAgentView {
  if ('taskEngine' in input) {
    return { phase: input.taskEngine.phase() }
  }
  return input
}

export function mapCodingAgentToDesktopEvents(input: CodingAgent | CodingAgentView): DesktopCodingEvent[] {
  const view = asView(input)
  const events: DesktopCodingEvent[] = []
  if (view.phase !== 'idle') {
    events.push({ type: 'task-updated', phase: view.phase as TaskPhase })
  }
  if (view.lastVerify && view.lastVerify.length > 0) {
    events.push({ type: 'verify-finished', ok: view.lastVerify.every((item) => item.ok) })
  }
  return events
}
