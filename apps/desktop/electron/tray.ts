/** Task 1.5 — system tray: pure menu-template builder + installer. */

import type { RuntimeState } from './runtime/runtime-types'

export interface TrayActions {
  toggleWindow: () => void
  startRuntime: () => void
  stopRuntime: () => void
  openLogs: () => void
  quit: () => void
}

export interface TrayMenuItem {
  label?: string
  enabled?: boolean
  type?: 'normal' | 'separator'
  click?: () => void
}

/** Pure: build the tray menu template from the current runtime state. */
export function buildTrayMenuTemplate(state: RuntimeState | 'unknown', actions: TrayActions): TrayMenuItem[] {
  const running = state === 'ready' || state === 'starting'
  return [
    { label: 'Show / Hide Window', click: actions.toggleWindow },
    { type: 'separator' },
    { label: `Runtime: ${state}`, enabled: false },
    { label: running ? 'Stop Runtime' : 'Start Runtime', click: running ? actions.stopRuntime : actions.startRuntime },
    { type: 'separator' },
    { label: 'Open Logs', click: actions.openLogs },
    { type: 'separator' },
    { label: 'Quit DeepSeek Harness Desktop', click: actions.quit }
  ]
}
