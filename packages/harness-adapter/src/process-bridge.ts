import { join } from 'node:path'
import { readMemory, renderProjectSnapshot, snapshotProject } from '@dshd/coding-agent'

export { interpretCommandResult, SessionLoop } from './session-loop'

export type SnapshotPorts = {
  readText(path: string): Promise<string | null>
  listDir(path: string): Promise<string[]>
}

export type PreStepInput = {
  sessionId: string
  cwd: string | undefined
  alreadyInjected: Set<string>
}

/**
 * The injection key: session + cwd, so switching workspace in the same
 * session re-injects (and the set never grows with stale session ids).
 */
export function contextKey(sessionId: string, cwd: string): string {
  return `${sessionId}::${cwd}`
}

export async function prepareProjectContextMessage(
  input: PreStepInput,
  ports: SnapshotPorts,
): Promise<{ content: string; key: string } | null> {
  if (!input.cwd) return null
  const key = contextKey(input.sessionId, input.cwd)
  if (input.alreadyInjected.has(key)) return null
  try {
    const snapshot = await snapshotProject(input.cwd, ports)
    const rawMemory = await ports.readText(join(input.cwd, '.dsh', 'memory.md'))
    const memory = rawMemory ? readMemory(rawMemory) : ''
    const body = renderProjectSnapshot(snapshot)
    const content = memory
      ? `${body}\n\n<system-reminder>\nProject memory:\n${memory}\n</system-reminder>`
      : body
    // The caller marks the key AFTER the content is safely in hand (e.g. past
    // a timeout race); this function never marks, so a timed-out snapshot is
    // retried on the next pre-step instead of being lost forever.
    return { content, key }
  } catch {
    return null
  }
}
