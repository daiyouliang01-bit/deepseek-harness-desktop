// Resolve the file-preview root from the same session/workspace state used by
// the desktop sidebar. The Electron process cwd is not a workspace cwd.
import { useEffect } from 'react'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { fpCall } from './api.ts'
import { getPanelState, setRoot } from './panel-store.ts'

export type GlobalSlotProps = {
  useSessions: <T>(selector: (state: SessionListState) => T) => T
  useWorkspaces: <T>(selector: (state: WorkspaceListState) => T) => T
}

/** Prefer the current session directory, then the most recently used workspace. */
export function pickWorkspaceRoot(sessionCwd: string | undefined, workspacePath: string | undefined): string {
  const sessionRoot = sessionCwd?.trim()
  if (sessionRoot) return sessionRoot
  return workspacePath?.trim() ?? ''
}

export function useWorkspaceRoot({ useSessions, useWorkspaces }: GlobalSlotProps): string {
  const sessionCwd = useSessions((state) => {
    const current = state.current
    return current === undefined ? undefined : state.byId[current]?.cwd
  })
  const workspacePath = useWorkspaces((state) => {
    const recent = state.items.find((item) => item.workspaceId === state.recentWorkspaceId)
    return (recent ?? state.items[0])?.path
  })
  return pickWorkspaceRoot(sessionCwd, workspacePath)
}

/** Keep the host allow-list and the drawer's visible root in sync with DSH. */
export function useSyncWorkspaceRoot(props: GlobalSlotProps): string {
  const root = useWorkspaceRoot(props)

  useEffect(() => {
    let cancelled = false
    if (!root) {
      setRoot('')
      return () => { cancelled = true }
    }

    // Do not leave the previous workspace visible while the new root is being
    // authorized by the host. A late response from the previous root is ignored.
    if (getPanelState().root !== root) setRoot('')
    void fpCall<{ root: string }>('setRoot', { root })
      .then((result) => {
        if (!cancelled && result?.root === root) setRoot(result.root)
      })
      .catch(() => {
        // The drawer remains in its empty state if the workspace disappeared.
      })

    return () => { cancelled = true }
  }, [root])

  return root
}
