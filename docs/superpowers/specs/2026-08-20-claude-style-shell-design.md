# Claude 式桌面壳设计（Desktop Custom Shell）

> 版本：v1.0
> 状态：已与用户确认方向，待实现
> 时间：2026-08-20
> 落点：DeepSeekHarnessDesktop（官方 Web UI 零改动）

---

## 0. 结论先行

桌面壳从「4 页面导航」改成 **GPT/Claude Code 式三栏常驻**：

```
┌─────┬──────────────┬───────────────────────────────┐
│ 64px│ 会话列表 280px │  ChatView（绝对主角）           │
│ 图标 │              │  顶部：会话标题栏（可重命名）     │
│ 💬  │  ⌕ 搜索  [+新] │                               │
│ 📁  │  PROJECT      │  ┌─ 消息流（大量留白）───────┐  │
│ 📱  │  DSH Desktop  │  │  You / Agent 气泡        │  │
│ ⚙️  │  CHATS        │  │  [Activity Card]         │  │
│     │  Fix reconnect│  │  [Change Card]           │  │
│     │  ...          │  │  [Verification]          │  │
│     │               │  └──────────────────────────┘  │
│     │  Skills       │  ┌─ 浮动 Composer ───────────┐  │
│     │  Settings     │  │ Ask DeepSeek Harness…  ↑ │  │
│     │               │  │ ＋ 模型  Auto             │  │
│     │               │  └──────────────────────────┘  │
├─────┴──────────────┴───────────────────────────────┤
│  DSH 0.1.0-rc.x   Context 34%   workspace-write    │
└────────────────────────────────────────────────────┘
```

核心原则：**聊天就是 Coding Agent**。用户打开项目 → 说一句话 → Agent 开始工作。不做 Coding → Tasks → Agent → Workflow → Run 的页面阶梯；Harness / MCP / Skills / Memory / Task Engine / Verifier 全部藏在下面。

---

## 1. 布局（AppShell.tsx + Sidebar.tsx）

- `Sidebar.tsx`：220px 文字导航 → **64px 窄图标栏**（💬 会话 / 📁 项目 / 📱 手机 / ⚙️ 设置，保留现有 4 个入口 + updateBadge）
- `AppShell.tsx`：conversations 视图改为三栏；projects/settings 仍在主区切换（不破坏现有面板）
- 会话列表从 ConversationsPanel 拆出为**常驻** `ConversationList.tsx`

## 2. 会话列表（重写 ConversationsPanel → ConversationList）

- **分组**：今天 / 昨天 / 前 7 天 / 更早（跨年按年份）
- **相对时间**：刚刚 / N 分钟前 / 昨天 / N 天前
- **运行指示**：live 会话右侧小圆点，运行中轻微高亮
- **悬停操作**：重命名 ✎ / 归档 🗂（图标，不占常驻空间）
- **右键菜单**：重命名 / 归档 / 复制 sessionId
- **搜索置顶**：输入即搜（复用 `session.search`）
- **PROJECT / CHATS 分区**：CHATS 常驻；PROJECT 区显示当前 cwd 名（后续多项目树，默认不展开）

## 3. 聊天主区：Activity / Change / Verification 卡片（ChatView + event-reducer）

- **Activity Card**（Agent 工作时唯一呈现，替代逐条 tool 日志）：
  ```
  Working · 24s
  ✓ Explored project
  ✓ Read 6 files
  ✓ Modified 2 files
  ● Running tests…
        Show details ▾   ← 展开才见逐条工具明细
  ```
  - `event-reducer`：同一 turn 内的 `tool-call/result` 聚合为步骤数组（按工具名归类计数），不逐条进消息流
- **Change Card**：turn 结束时检测到 `write/edit/str_replace_editor` 成功 → 显示改动文件清单（**不含行数，只聚合文件名**，已确认）：
  ```
  Changes · 4 files
  M verifier.ts
  A verifier.test.ts
  View details →
  ```
- **Verification Card**：消费已有 `task-updated` / `verify-finished` 事件：
  ```
  Verification
  ✓ Typecheck  ✓ 21 tests  ✓ Lint
  ```

## 4. 任务状态：只显示轻量状态（不建 Task 面板）

底层 TaskEngine 不动。UI 只消费 `task-updated` 事件做三段式提示：
`● Planning… → ◐ Working… → ✓ Done / ✗ Failed`
放在标题栏右侧或 Activity Card 顶部。绝不做独立 Task 页面。

## 5. 浮动 Composer（ChatView 底部）

```
┌──────────────────────────────────────────┐
│ Ask DeepSeek Harness…                    │
│ ＋   DeepSeek V3.2    Auto          ↑   │
└──────────────────────────────────────────┘
```
- ＋ 只放高频：文件 / 图片 / Context（图片拖拽已有，文件/Context 后续）
- 只留 Model / Mode 两个选择器；MCP / Skills / Memory / Hooks / Verifier 全部隐藏（默认自动工作）

## 6. 右侧 Inspector：按需滑出（新文件 Inspector.tsx）

- 默认右侧**什么都没有**
- 点 Change Card 的 View details / Context / 任务详情 → 滑出 320px 面板
- 关闭即回到纯聊天
- 内容：改动文件清单、context 摘要、task 详情（diff 全文后续再补）

## 7. 视觉：GPT Desktop 风（app.css / token）

- 深灰背景 + 极少边框 + 大圆角 + 留白 + 弱层级色
- 状态靠 ✓ / ● / 文件名 / 计数表达，不用彩色 badge 堆砌
- 观感：**一个安静的桌面 Coding Agent**，不是 "Harness 的 GUI"

## 8. 设置 → 已归档会话（SettingsPanel 新增区块）

- 列表：已归档会话 + 归档时间
- 操作：**仅恢复（unarchive）**，不做删除（已确认；官方无 session.delete，永久删除只能删本地缓存，本轮不做）
- 数据层：`session-adapter` 新增 `listArchived()`；SessionStore 已有 `setArchived`，补归档列表查询

## 9. 数据层改动汇总

| 文件 | 改动 |
|---|---|
| `features/layout/AppShell.tsx` | 三栏布局接线 |
| `features/sidebar/Sidebar.tsx` | 窄图标栏 |
| `features/conversations/ConversationsPanel.tsx` | 拆为常驻 ConversationList + 列表逻辑 |
| `features/chat/event-reducer.ts` + test | 工具调用聚合（activity 步骤 + change 汇总） |
| `features/chat/ChatView.tsx` | Activity/Change/Verification 卡片 + 浮动 Composer + 标题栏 |
| 新 `features/chat/ActivityCard.tsx` / `ChangeCard.tsx` | 聚合卡片组件 |
| 新 `features/inspector/Inspector.tsx` | 按需滑出面板 |
| `features/settings/SettingsPanel.tsx` | 已归档会话区块（恢复） |
| `electron/adapter/session-adapter.ts` | `list()` 过滤本地归档 + 新增 `listArchived()` |
| `electron/main/index.ts` + `preload/index.ts` | 新增 IPC `session:list-archived` |

## 10. 明确不做（本轮）

- 不做永久删除（官方无 session.delete；只做恢复）
- 不做 diff 行数统计（Change Card 只列文件名）
- 不做多项目树（PROJECT 区先显示当前 cwd 名）
- 不改官方 Web UI / 官方 npm 包
- 不做 Task 面板、Workflow 面板
- 自动标题用本地截断首条消息（不写官方 rename）

## 11. 验收

1. `pnpm test` 全绿（含 event-reducer 聚合新测试）
2. `pnpm typecheck` 全绿
3. 三栏布局：窄导航 + 会话列表 + 聊天主区
4. 工具调用不再逐条刷日志，显示聚合 Activity Card
5. 设置 → 已归档会话：归档的会话出现、可恢复、恢复后回列表
6. 新会话首条消息后显示自动标题（本地截断）
