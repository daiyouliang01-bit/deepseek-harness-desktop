# Claude 式桌面壳实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面壳改成 GPT/Claude 式三栏常驻布局：窄图标导航 + 常驻会话列表（分组/自动标题/悬停操作）+ 聊天主区（Activity/Change/Verification 卡片、浮动 Composer），设置新增「已归档会话」（仅恢复）。

**Architecture:** 纯前端重构（React + 现有 darkTokens），数据层只加两个 IPC（listArchived / unarchive）和一个 store 查询。事件聚合在 event-reducer（纯函数，可单测）。官方 Web UI 零改动。

**Tech Stack:** React 18, @dshd/ui tokens, SQLite（session-store）, Electron IPC

**Spec:** `docs/superpowers/specs/2026-08-20-claude-style-shell-design.md`

## Global Constraints

- 官方 Web UI / 官方 npm 包零改动
- 不做永久删除（官方无 session.delete）
- Change Card 不显示行数，只聚合文件名
- 自动标题用本地截断首条消息（不写官方 rename）
- 不建 Task 面板 / Workflow 面板
- `pnpm test` 与 `pnpm typecheck` 必须全绿

---

### Task 1: 会话数据层 — 归档列表与恢复 IPC

**Files:**
- Modify: `packages/session-store/src/repository.ts`（新增 `listArchived()`）
- Modify: `apps/desktop/electron/adapter/session-adapter.ts`（`list()` 过滤归档 + `listArchived()`）
- Modify: `apps/desktop/electron/main/index.ts`（IPC `sessions:list-archived` / `sessions:unarchive`）
- Modify: `apps/desktop/electron/preload/index.ts`（`sessionListArchived` / `sessionUnarchive`）
- Test: `packages/session-store/src/repository.test.ts`

**Interfaces:**
- Consumes: `SessionStore`（已有 `setArchived`/`isArchived`/`listConversations`）
- Produces:
  - `SessionStore.listArchived(): ConversationRow[]`（archived=1，按 updated_at DESC）
  - `SessionAdapter.listArchived(): SessionSummary[]`
  - `SessionAdapter.list(): SessionSummary[]`（过滤 `store.isArchived(id)` 的项）
  - preload `sessionListArchived(): Promise<SessionOpResult<SessionSummary[]>>`
  - preload `sessionUnarchive(id): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: 写失败测试**（repository.test.ts 追加）

```ts
it('listArchived returns only archived conversations, newest first', () => {
  const store = freshStore()
  const a = store.createConversation('archived-a')
  const b = store.createConversation('archived-b')
  store.setArchived(a.id, true)
  store.setArchived(b.id, true)
  const all = store.listArchived()
  expect(all.map((c) => c.id)).toContain(a.id)
  expect(all.every((c) => c.archived === 1)).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**（`listArchived` 未定义）

- [ ] **Step 3: 实现 `listArchived`**（repository.ts）

```ts
listArchived(): ConversationRow[] {
  return this.listConversations(10_000, true).filter((c) => c.archived === 1)
}
```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: adapter 过滤 + listArchived**（session-adapter.ts）

```ts
async list(): Promise<SessionSummary[]> {
  const res = await this.client.unary<{ items: SessionSummary[] }>('session.list', {})
  for (const item of res.items) this.store.upsertConversation(item.sessionId, item.title ?? '', item.updatedAt)
  return res.items.filter((item) => !this.store.isArchived(item.sessionId))
}

listArchived(): SessionSummary[] {
  return this.store.listArchived().map((c) => ({
    sessionId: c.id,
    updatedAt: new Date(c.updated_at).getTime(),
    running: false,
    blank: false,
    title: c.title || undefined,
  }))
}
```

- [ ] **Step 6: main IPC**（main/index.ts，紧跟 sessions:archive handler）

```ts
ipcMain.handle('sessions:list-archived', () => {
  const current = ensureSessionAdapter()
  if (!current) return { ok: false, error: 'runtime not ready' }
  return { ok: true, value: current.listArchived() }
})
ipcMain.handle('sessions:unarchive', (_e, sessionId: string) => {
  const current = ensureSessionAdapter()
  if (!current) return { ok: false, error: 'runtime not ready' }
  current.unarchive(String(sessionId))
  return { ok: true }
})
```

- [ ] **Step 7: preload**（preload/index.ts，紧跟 sessionArchive）

```ts
sessionListArchived: (): Promise<SessionOpResult<SessionSummary[]>> => ipcRenderer.invoke('sessions:list-archived'),
sessionUnarchive: (sessionId: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('sessions:unarchive', sessionId),
```

- [ ] **Step 8: 跑 desktop 测试 + typecheck + 提交**

```bash
pnpm --filter @dshd/session-store test
pnpm --filter @dshd/desktop test
pnpm typecheck
git add -A && git commit -m "feat: archived session list + unarchive IPC"
```

---

### Task 2: event-reducer 工具调用聚合

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/chat/event-reducer.ts`
- Modify: `apps/desktop/src/renderer/src/features/chat/event-reducer.test.ts`

**Interfaces:**
- Consumes: 现有 `ToolCallState`（callId/name/args/status/output）
- Produces:
  - `ChatState.turnActivity?: TurnActivity`
  - `TurnActivity = { startedAt: number; steps: ActivityStep[]; phase: 'working' | 'verifying' | 'done' }`
  - `ActivityStep = { label: string; status: 'done' | 'running' | 'failed' }`
  - `ChatState.changes?: Array<{ path: string; kind: 'write' | 'edit' | 'str_replace_editor' }>`
  - `finishTurnActivity(state): ChatState`（turn 结束时把 toolCalls 折叠成 steps + 汇总 changes）

- [ ] **Step 1: 写失败测试**

```ts
it('collapses tool calls into aggregated activity steps', () => {
  let s = initialState
  s = reduceEvent(s, { type: 'message', id: 'u1', role: 'user', content: 'fix it', ts: 1 })
  s = reduceEvent(s, { type: 'tool-call', id: 't1', callId: 'c1', name: 'read', args: {}, ts: 2 })
  s = reduceEvent(s, { type: 'tool-result', id: 'r1', callId: 'c1', name: 'read', ok: true, output: '', ts: 3 })
  s = reduceEvent(s, { type: 'tool-call', id: 't2', callId: 'c2', name: 'write', args: {}, ts: 4 })
  s = reduceEvent(s, { type: 'tool-result', id: 'r2', callId: 'c2', name: 'write', ok: true, output: '', ts: 5 })
  s = finishTurnActivity(s)
  expect(s.turnActivity?.steps).toEqual([
    { label: 'read', status: 'done', count: 1 },
    { label: 'write', status: 'done', count: 1 },
  ])
  expect(s.changes).toEqual([{ path: '', kind: 'write' }])
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现聚合**（event-reducer.ts）

```ts
export interface ActivityStep { label: string; status: 'done' | 'running' | 'failed'; count: number }
export interface TurnActivity { startedAt: number; steps: ActivityStep[]; phase: 'working' | 'verifying' | 'done' }
export interface ChangeSummary { path: string; kind: 'write' | 'edit' | 'str_replace_editor' }

export function finishTurnActivity(state: ChatState): ChatState {
  const last = lastMessage(state)
  if (!last || last.role !== 'assistant') return state
  const byName = new Map<string, ActivityStep>()
  const changes: ChangeSummary[] = []
  for (const tc of last.toolCalls) {
    const hit = byName.get(tc.name) ?? { label: tc.name, status: 'done' as const, count: 0 }
    hit.count += 1
    if (tc.status === 'running') hit.status = 'running'
    else if (tc.status === 'failed') hit.status = 'failed'
    byName.set(tc.name, hit)
    if (tc.status === 'ok' && ['write', 'edit', 'str_replace_editor'].includes(tc.name)) {
      changes.push({ path: extractPath(tc.args), kind: tc.name as ChangeSummary['kind'] })
    }
  }
  return {
    ...state,
    turnActivity: { startedAt: last.ts, steps: [...byName.values()], phase: 'done' },
    changes: changes.length > 0 ? changes : state.changes,
  }
}

function extractPath(args: unknown): string {
  if (args && typeof args === 'object') {
    const rec = args as Record<string, unknown>
    if (typeof rec.path === 'string') return rec.path
    if (typeof rec.file_path === 'string') return rec.file_path
    if (typeof rec.filePath === 'string') return rec.filePath
  }
  return ''
}
```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/features/chat/
git commit -m "feat: aggregate tool calls into activity steps + change summary"
```

---

### Task 3: 布局 — 窄图标导航 + 三栏骨架

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/sidebar/Sidebar.tsx`
- Modify: `apps/desktop/src/renderer/src/features/layout/AppShell.tsx`
- Create: `apps/desktop/src/renderer/src/features/conversations/ConversationList.tsx`（先从 ConversationsPanel 拆出纯列表，Task 4 再打磨）

**Interfaces:**
- Consumes: `ShellView`（现有），`SessionSummary`（Task 1）
- Produces: `ConversationList({ tokens, activeSessionId, onSelect })`（Props 与 ConversationsPanel 一致，先搬逻辑）

- [ ] **Step 1: Sidebar 改窄图标栏**

把 `Sidebar.tsx` 的 nav 宽度 220 → 64，label 隐藏（只留图标 + title 属性），保留 updateBadge 红点。

- [ ] **Step 2: ConversationList.tsx 拆出**

新建 `ConversationList.tsx`，内容 = 现 ConversationsPanel 去掉 maxWidth 包装，去掉 Rename/Archive 内联按钮（Task 4 换悬停），保留 create/search/list/history 逻辑。

- [ ] **Step 3: AppShell 三栏接线**

conversations 视图改为：

```tsx
<div style={{ display: 'flex', height: '100vh', background: colors.bg, color: colors.text }}>
  <Sidebar ... />
  <ConversationList tokens={tokens} activeSessionId={activeSessionId} onSelect={setActiveSessionId} />
  <main style={{ flex: 1, overflow: 'auto', padding: tokens.space.lg }}>
    <ChatView tokens={tokens} activeSessionId={activeSessionId} />
  </main>
</div>
```

- [ ] **Step 4: 手动验证 + 提交**

```bash
pnpm --filter @dshd/desktop test
git add -A && git commit -m "feat: three-column shell with narrow icon nav + persistent conversation list"
```

---

### Task 4: 会话列表打磨 — 分组 / 相对时间 / 悬停操作 / 自动标题

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/conversations/ConversationList.tsx`

- [ ] **Step 1: 工具函数**（同文件顶部）

```ts
function groupOf(ts: number, now: number): string {
  const day = 86_400_000
  const today = new Date(now).setHours(0, 0, 0, 0)
  const that = new Date(ts).setHours(0, 0, 0, 0)
  if (that === today) return '今天'
  if (that === today - day) return '昨天'
  if (that >= today - 7 * day) return '前 7 天'
  return new Date(ts).getFullYear().toString()
}

function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86_400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 86_400 * 7) return `${Math.floor(s / 86_400)} 天前`
  return new Date(ts).toLocaleDateString()
}

function autoTitle(s: SessionSummary, query: string): string {
  if (s.title && s.title.trim()) return s.title
  const fallback = s.sessionId.slice(0, 8)
  return query ? `搜索: ${query}` : `新会话 ${fallback}`
}
```

- [ ] **Step 2: 分组渲染**

`sessions` 按 `groupOf(updatedAt, Date.now())` 分组，组内按 updatedAt 降序，渲染「组标题 + 项」。

- [ ] **Step 3: 悬停操作 + 右键菜单**

每项 `onMouseEnter` 显示重命名 ✎ / 归档 🗂 图标按钮（stopPropagation）；`onContextMenu` 打开自制小菜单（重命名 / 归档 / 复制 id）。

- [ ] **Step 4: 自动标题接入**

列表项显示 `autoTitle(s, query)`；新会话创建后、首条消息到达时（监听 agent 事件里的第一条 user message），本地 setState 更新标题（不写官方）。

- [ ] **Step 5: 测试 + 提交**

```bash
pnpm --filter @dshd/desktop test
git add -A && git commit -m "feat: grouped conversation list with hover actions and auto titles"
```

---

### Task 5: ChatView — Activity/Change/Verification 卡片 + 浮动 Composer + 标题栏

**Files:**
- Create: `apps/desktop/src/renderer/src/features/chat/ActivityCard.tsx`
- Create: `apps/desktop/src/renderer/src/features/chat/ChangeCard.tsx`
- Modify: `apps/desktop/src/renderer/src/features/chat/ChatView.tsx`

**Interfaces:**
- Consumes: `state.turnActivity` / `state.changes` / `state.taskPhase` / `state.verifyOk`（Task 2）
- Produces: ActivityCard/ChangeCard 组件；ChatView 渲染顺序：标题栏 → 消息流（含卡片）→ 浮动 Composer

- [ ] **Step 1: ActivityCard.tsx**

```tsx
export function ActivityCard({ activity, tokens }: { activity: TurnActivity; tokens: Tokens }): React.JSX.Element {
  // Working · Ns
  //   ✓ label ×count
  //   ● Running…
  //   Show details ▾ (展开渲染原始 toolCalls)
}
```

- [ ] **Step 2: ChangeCard.tsx**

```tsx
export function ChangeCard({ changes, tokens, onView }: { changes: ChangeSummary[]; tokens: Tokens; onView?: () => void }): React.JSX.Element {
  // Changes · N files
  //   M verifier.ts  (kind → M/A 映射)
  //   View details →
}
```

- [ ] **Step 3: ChatView 接线**

- 标题栏：`activeSessionId` 对应会话标题（读 sessions 列表）+ taskPhase 轻量状态（● Working / ✓ Verified）
- 消息流：assistant 消息渲染后，若 `turnActivity` 存在渲染 ActivityCard；`changes` 存在渲染 ChangeCard；`verifyOk !== undefined` 渲染 Verification 摘要行
- 底部改浮动 Composer（现输入框包一层，加 Model/Mode 占位选择器）

- [ ] **Step 4: 测试 + 提交**

```bash
pnpm --filter @dshd/desktop test
git add -A && git commit -m "feat: activity/change/verification cards + floating composer + session title bar"
```

---

### Task 6: 设置 → 已归档会话（仅恢复）

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/settings/SettingsPanel.tsx`

- [ ] **Step 1: 新区块**

```tsx
function ArchivedSection({ tokens }: { tokens: Tokens }): React.JSX.Element {
  // 列表: sessionListArchived() → 每项 title + 归档时间 + [恢复] 按钮
  // 恢复: sessionUnarchive(id) → refresh
}
```

- [ ] **Step 2: 渲染**（SettingsPanel 内 `<ArchivedSection tokens={tokens} />`）

- [ ] **Step 3: 测试 + 提交**

```bash
pnpm --filter @dshd/desktop test
git add -A && git commit -m "feat: archived conversations section in settings (restore only)"
```

---

### Task 7: 视觉打磨 + 全量验证

**Files:**
- Modify: `apps/desktop/src/renderer/src/app.css`（背景/圆角/边框微调）

- [ ] **Step 1: 视觉微调**（浅灰/深灰背景、大圆角、弱边框、留白）

- [ ] **Step 2: 全量验证**

```bash
pnpm test
pnpm exec vitest run --root .
pnpm typecheck
```

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "style: GPT-desktop visual pass (quiet surfaces, soft borders)"
```
