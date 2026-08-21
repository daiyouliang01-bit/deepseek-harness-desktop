// src/client/tabs.ts
export type TabKind = 'md' | 'code' | 'pdf' | 'image' | 'html' | 'docx' | 'binary' | 'txt'
export interface PreviewTab { id: string; path: string; name: string; kind: TabKind; openedAt: number; /** watcher 检测到外部修改后置位，用户看到横幅后清除 */ externallyUpdated?: boolean }

let seq = 0
function nextId(): string { return `tab-${Date.now()}-${seq++}` }

export function kindForPath(p: string): TabKind {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'docx' || ext === 'doc' || ext === 'rtf') return 'docx'
  if (ext === 'txt') return 'txt'
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'yml', 'yaml', 'toml', 'sh', 'py', 'go', 'rs', 'c', 'h', 'cpp', 'java', 'xml', 'sql', 'vue', 'svelte']
  if (codeExts.includes(ext)) return 'code'
  return 'binary'
}

export function openTab(state: PreviewTab[], tab: Omit<PreviewTab, 'id' | 'openedAt'>): { tabs: PreviewTab[]; activeId: string } {
  const existing = state.find((t) => t.path === tab.path)
  if (existing) return { tabs: state, activeId: existing.id }
  if (state.length >= 8) return { tabs: state, activeId: state.length > 0 ? state[state.length - 1]!.id : '' }
  const full: PreviewTab = { ...tab, id: nextId(), openedAt: Date.now() }
  return { tabs: [...state, full], activeId: full.id }
}

export function closeTab(state: PreviewTab[], activeId: string | null, id: string): { tabs: PreviewTab[]; activeId: string | null } {
  const idx = state.findIndex((t) => t.id === id)
  if (idx === -1) return { tabs: state, activeId }
  const tabs = state.filter((t) => t.id !== id)
  let nextActive = activeId
  if (activeId === id) nextActive = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
  return { tabs, activeId: nextActive }
}
