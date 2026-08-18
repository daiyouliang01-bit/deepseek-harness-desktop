/** Task 1.5 + shell toggle — application menu template (pure). */

export interface AppMenuActions {
  openCustomShell: () => void
  openOfficialUI: () => void
  reload: () => void
  quit: () => void
}

export interface AppMenuItem {
  label?: string
  role?: string
  type?: 'normal' | 'separator'
  click?: () => void
  accelerator?: string
  submenu?: AppMenuItem[]
}

/** Pure: build the macOS/Windows application menu. */
export function buildAppMenuTemplate(actions: AppMenuActions): AppMenuItem[] {
  return [
    {
      label: 'DeepSeek Harness Desktop',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CommandOrControl+Q', click: actions.quit }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Custom Shell (preview)', click: actions.openCustomShell },
        { label: 'Official Web UI', click: actions.openOfficialUI },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CommandOrControl+R', click: actions.reload },
        { role: 'toggleDevTools' }
      ]
    }
  ]
}
