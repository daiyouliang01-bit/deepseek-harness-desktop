// src/client/preview-panel.tsx
// 右侧多标签预览面板 + 左侧文件树抽屉。两个浮层都订阅共享 store：
// PreviewPanel 以 store prop 传入快照，交互调用 store 方法；PreviewDrawer
// 经 usePanelState 读取 root。可见性由 index.tsx 的 overlay 注册决定
// （不可见时返回 null，不占用渲染）。
import { useCallback } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { fpCall } from './api.ts'
import { ContentView } from './renderers.tsx'
import { FileTree } from './file-tree.tsx'
import { activateFile, closeFile, closePanel, refreshFile, usePanelState, clearExternalUpdate } from './panel-store.ts'
import type { PanelStore } from './panel-store.ts'

const PANEL_WIDTH = 480
const DRAWER_WIDTH = 260

export function PreviewPanel({ store }: { store: PanelStore }): ReactElement {
  const { tabs, activeId } = store
  const active = tabs.find((t) => t.id === activeId) ?? null

  const copyPath = useCallback(async () => {
    if (!active) return
    try { await navigator.clipboard.writeText(active.path) } catch { /* ignore */ }
  }, [active])

  const openExternal = useCallback(() => {
    if (!active) return
    fpCall<{ ok: boolean }>('openInApp', { path: active.path }).catch(() => {})
  }, [active])

  const refresh = useCallback(() => {
    if (active) refreshFile(active.id)
  }, [active])

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: PANEL_WIDTH, display: 'flex', flexDirection: 'column', pointerEvents: 'auto', background: 'var(--color-bg-elevated, #1a1a2e)', borderLeft: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', boxShadow: '-8px 0 32px rgba(0,0,0,0.25)', zIndex: 9999, fontFamily: 'inherit' }}>
      {/* tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 8px', borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', flexShrink: 0 }}>
        {tabs.map((t) => (
          <div key={t.id} onClick={() => activateFile(t.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: t.id === activeId ? 'var(--color-bg-active, rgba(255,255,255,0.1))' : 'transparent', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 140 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
            <span role="button" onClick={(e) => { e.stopPropagation(); closeFile(t.id) }} style={{ opacity: 0.6, padding: '0 2px' }}>×</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={closePanel} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14, opacity: 0.7 }}>✕</button>
      </div>
      {/* toolbar */}
      {active?.externallyUpdated && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: '1px solid rgba(255,180,60,0.35)', background: 'rgba(255,180,60,0.12)', flexShrink: 0, fontSize: 12 }}>
          <span style={{ color: '#ffb43c' }}>⟳ 文件已被外部修改，预览已自动更新</span>
          <button onClick={() => clearExternalUpdate(active.id)} style={{ ...toolBtn, border: 0 }}>知道了</button>
        </div>
      )}
      {active && (
        <div style={{ display: 'flex', gap: 6, padding: '4px 8px', borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', flexShrink: 0, fontSize: 12 }}>
          <button onClick={openExternal} style={toolBtn}>用默认应用打开</button>
          <button onClick={copyPath} style={toolBtn}>复制路径</button>
          <button onClick={refresh} style={toolBtn}>刷新</button>
        </div>
      )}
      {/* content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {active ? <ContentView key={active.id + '-' + active.openedAt} kind={active.kind} path={active.path} />
          : <div style={{ padding: 24, fontSize: 13, color: 'var(--color-text-muted, #999)' }}>从文件树或手动打开一个文件</div>}
      </div>
    </div>
  )
}

const toolBtn: CSSProperties = {
  background: 'none', border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.15))',
  borderRadius: 6, color: 'inherit', cursor: 'pointer', fontSize: 12, padding: '2px 8px',
}

export function PreviewDrawer({ onOpenFile, onClose }: { onOpenFile(p: string): void; onClose(): void }): ReactElement {
  const { root } = usePanelState()
  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 0, width: DRAWER_WIDTH, display: 'flex', flexDirection: 'column', pointerEvents: 'auto', background: 'var(--color-bg-elevated, #1a1a2e)', borderRight: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', boxShadow: '8px 0 32px rgba(0,0,0,0.25)', zIndex: 9998 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', fontSize: 13, fontWeight: 600 }}>
        <span>📁 文件</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.7 }}>✕</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {root
          ? <FileTree key={root} root={root} onOpen={onOpenFile} />
          : <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-muted, #999)' }}>正在定位当前工作区…</div>}
      </div>
    </div>
  )
}
