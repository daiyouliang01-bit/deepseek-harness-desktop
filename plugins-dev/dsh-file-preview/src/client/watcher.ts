// src/client/watcher.ts
// 原生自动刷新：面板打开时每 2s 批量 stat 打开的文件，mtime 变化 →
// refreshFile（openedAt 前进 → ContentView 以 key 重挂载并重新读取）。
// 轮询而非 fs.watch：host 与 client 之间只有 HTTP 一条通道，SSE 属于后续增强。
import { fpCall } from './api.ts'
import { getPanelState, refreshFile } from './panel-store.ts'

const POLL_MS = 2000
const known = new Map<string, number>() // path → 上次见到的 mtime

let timer: ReturnType<typeof setInterval> | null = null

export function startFileWatcher(): void {
  if (timer) return
  timer = setInterval(() => {
    const { tabs, panelVisible } = getPanelState()
    if (!panelVisible || tabs.length === 0) return
    void fpCall<Array<{ path: string; mtime: number; exists: boolean }>>('statMany', {
      paths: tabs.map((t) => t.path),
    })
      .then((rows) => {
        const seen = new Set<string>()
        for (const row of rows) {
          seen.add(row.path)
          const prev = known.get(row.path)
          known.set(row.path, row.mtime)
          if (prev === undefined || prev === row.mtime) continue
          const tab = getPanelState().tabs.find((t) => t.path === row.path)
          if (tab) refreshFile(tab.id)
        }
        // 关掉的标签不再跟踪
        for (const p of [...known.keys()]) if (!seen.has(p)) known.delete(p)
      })
      .catch(() => undefined)
  }, POLL_MS)
}

export function stopFileWatcher(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
