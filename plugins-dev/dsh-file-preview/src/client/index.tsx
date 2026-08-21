// src/client/index.tsx
// 预览插件 browser 半：三个 slot 贡献——
// - sidebar.footer.action「文件」按钮：切换文件树抽屉显隐；
// - shell.overlay 文件树抽屉（左侧，z-index 9998）；
// - shell.overlay 多标签预览面板（右侧，z-index 9999）。
// 全部经共享 panel-store 交换状态（openFile/toggleDrawer/closePanel…）。
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import { fpCall } from './api.ts'
import { closeDrawer, openFile, toggleDrawer, usePanelState } from './panel-store.ts'
import { PreviewDrawer, PreviewPanel } from './preview-panel.tsx'
import { kindForPath } from './tabs.ts'
import { type GlobalSlotProps, useSyncWorkspaceRoot } from './workspace-root.ts'
import { startFileWatcher, stopFileWatcher } from './watcher.ts'

export const inject = ['slots']

export function apply(ctx: Context): () => void {
  const disposers: Array<() => void> = []
  startFileWatcher()
  disposers.push(() => stopFileWatcher())

  const handleOpenFromTree = (p: string): void => {
    fpCall<{ exists: boolean; isDir: boolean }>('stat', { path: p }).then((s) => {
      if (!s.exists || s.isDir) return
      const name = p.split('/').pop() ?? p
      openFile(p, name, kindForPath(p))
    }).catch(() => {})
  }

  disposers.push(ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'file-preview-open', order: 90,
  }, (props: GlobalSlotProps) => {
    useSyncWorkspaceRoot(props)
    usePanelState()
    return (
      <button onClick={toggleDrawer} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13, width: '100%' }}>
        <span>📁</span><span>文件</span>
      </button>
    )
  })))

  disposers.push(ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'file-preview-drawer', order: 90,
  }, (props: GlobalSlotProps) => {
    useSyncWorkspaceRoot(props)
    const s = usePanelState()
    if (!s.drawerVisible) return null
    return <PreviewDrawer onOpenFile={handleOpenFromTree} onClose={closeDrawer} />
  })))

  disposers.push(ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'file-preview-panel', order: 91,
  }, () => {
    const s = usePanelState()
    if (!s.panelVisible) return null
    return <PreviewPanel store={s} />
  })))

  return () => { for (const d of disposers) d() }
}
