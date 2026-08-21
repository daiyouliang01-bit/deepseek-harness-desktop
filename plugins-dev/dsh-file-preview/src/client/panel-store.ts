// src/client/panel-store.ts
// 跨组件共享的预览状态：多标签面板 + 文件树抽屉 + workspace 根目录。
// 单一模块 store + subscribe（仿 dsh-genui 的 panel-store 模式），
// 替代脆弱的 window 事件桥接——三个 slot 组件经 usePanelState 订阅同一份状态。
import { useEffect, useState } from 'react'
import { openTab, closeTab } from './tabs.ts'
import type { PreviewTab, TabKind } from './tabs.ts'

export interface PanelStore {
  tabs: PreviewTab[]
  activeId: string | null
  drawerVisible: boolean
  panelVisible: boolean
  root: string
}

const state: PanelStore = {
  tabs: [], activeId: null, drawerVisible: false, panelVisible: false, root: '',
}

let listeners: Array<() => void> = []
export function getPanelState(): PanelStore { return state }
export function subscribePanel(fn: () => void): () => void {
  listeners.push(fn)
  return () => { listeners = listeners.filter((l) => l !== fn) }
}
function emit(): void { for (const l of listeners) l() }

/** React hook：订阅 store，任一变更触发本组件重渲染。 */
export function usePanelState(): PanelStore {
  const [, force] = useState(0)
  useEffect(() => subscribePanel(() => force((n) => n + 1)), [])
  return getPanelState()
}

export function setRoot(root: string): void {
  const next = root.trim()
  if (state.root === next) return
  state.root = next
  emit()
}
export function toggleDrawer(): void { state.drawerVisible = !state.drawerVisible; emit() }
export function closeDrawer(): void { state.drawerVisible = false; emit() }
export function openPanel(): void { state.panelVisible = true; emit() }
export function closePanel(): void { state.panelVisible = false; emit() }
export function openFile(path: string, name: string, kind: TabKind): void {
  const r = openTab(state.tabs, { path, name, kind })
  state.tabs = r.tabs; state.activeId = r.activeId
  state.panelVisible = true
  emit()
}
export function closeFile(id: string): void {
  const r = closeTab(state.tabs, state.activeId, id)
  state.tabs = r.tabs; state.activeId = r.activeId
  emit()
}
export function activateFile(id: string): void { state.activeId = id; emit() }
export function refreshFile(id: string): void {
  const t = state.tabs.find((x) => x.id === id)
  if (t) {
    t.openedAt = Date.now()
    t.externallyUpdated = true
  }
  emit()
}

/** 用户已注意到外部修改横幅（切换标签或点关闭）。 */
export function clearExternalUpdate(id: string): void {
  const t = state.tabs.find((x) => x.id === id)
  if (t?.externallyUpdated) {
    t.externallyUpdated = false
    emit()
  }
}
