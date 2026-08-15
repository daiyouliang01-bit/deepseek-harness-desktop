# 自定义壳 ↔ Harness 真实事件流接入方案

> 目标：让自定义壳（ChatView）消费官方 Harness 的**真实** agent 事件流
> （流式输出、工具调用、审批、错误），替代当前的静态预览，官方 Web UI 降级为
> 可选视图（诊断开关保留）。
>
> 本方案基于对官方 wire 契约的源码级逆向（`@deepseek-ai/dsh-client-connection`、
> `dsh-host-apiproxy`、`dsh-session` 的类型定义），并参考 GitHub 桌面端主流方案
> （Cherry Studio、lencx/ChatGPT、Claude 桌面客户端）。**不 import 官方源码**，
> 只按文档化的 HTTP/WebSocket 边界通信（遵循计划全局约束）。

## 1. 官方边界逆向结论（证据）

来源：`~/node_modules/@deepseek-ai/`（dsh 0.1.0-rc.6 安装布局）
`packages/client/connection` + `packages/host/apiproxy` 的 `.d.ts` 契约层。

### 1.1 传输模型（四象限 RPC）

- **上行 = HTTP POST**：客户端命令（建会话/发消息/审批响应/历史查询），
  JSON envelope，`rpcId` 关联请求与响应。
- **下行 = WebSocket** 双流（downlink-only，客户端消息是协议违例）：
  - `/api/events.mux` —— 全会话聚合流：`session/event`（原始会话事件透传 +
    可选渲染意图 `view`）、`session/subscribed`（订阅基线，带 `lastSeq`）、
    `approval/requested`、`question/requested`（**可应答帧**，服务端请求）。
  - `/api/events.host` —— 宿主级流：会话创建/销毁、运行状态翻转、agent 级失败。
- **重连语义 = 重开流 + 补拉历史**（`session/subscribed.lastSeq` 是断点基线；
  `since` resume hook 在 v1 未实现，忽略）。

### 1.2 会话事件联合（SessionEventMap，即 mux 帧内的 event）

| 官方事件 | 语义 | 对应我们的协议 |
|---|---|---|
| `user/message` | 用户消息（surface 事件，携带 rpcId 对账字段） | `message` (user) |
| `assistant/chunk` | token 级原始流块（回放保真） | `delta` |
| `assistant/message` | 助手整条消息（surface 事件） | `message` (assistant) |
| `tool/call` / `tool/result` | 工具调用与结果（result 携带渲染意图 `ToolEventView`） | `tool-call` / `tool-result` |
| `turn/start` `turn/end` `step/start` `step/end` | 回合/步骤生命周期 | `completion`（turn/end 触发） |
| `error` | 结构化 LlmFailure（含 code） | `error`（走 classifyError） |
| `approval/requested`（mux 控制帧） | 审批请求，**rpcId 必须回显** | `approval-request` |
| `question/requested`（mux 控制帧） | AskUserQuestion（dsh-user-questions） | `question`（协议新增） |
| `todo/write` | 任务列表快照（log-only UI 状态） | 未来扩展（暂映射为 unknown） |
| `compaction/*` `request/header` `session/end-seed` … | 压缩/元数据/种子边界 | 忽略（`ignorable` 标记 + unknown 容忍） |

### 1.3 上行域（ApiProxy）

`sessions`（list/create/history/prompt/rename/delete/search…）、`approvals.respond`、
`questions.respond`、`goals`、`skills`、`settings`、`credentials`、`llm`（模型目录）……
桌面 Adapter 第一阶段只需要 `sessions.*` + 两个 respond。

### 1.4 信任与安全

- `/api` 受 browser-trust 栅栏保护（DNS-rebinding 防御）：**loopback Host 默认放行**。
  桌面主进程直连 `http://127.0.0.1:<port>`，Host 即 loopback —— **无需
  `--trusted-host`**。
- API Key 继续只存主进程（safeStorage，Task 3.5 已就位）；渲染层零密钥。

## 2. GitHub 桌面端参考与我们的定位

| 参考 | 模式 | 借鉴点 | 我们不用 |
|---|---|---|---|
| [lencx/ChatGPT](https://github.com/lencx/ChatGPT) | 包装官方 Web（webview/窗口层） | 窗口/托盘/升级的壳层工程；“不重写产品逻辑”的克制 | 内嵌官方 UI —— 我们要替换 UI |
| [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio)（[架构](https://deepwiki.com/CherryHQ/cherry-studio/3.1-electron-architecture) · [流式处理](https://deepwiki.com/CherryHQ/cherry-studio/5.5-streaming-and-message-processing)） | 多 Provider 客户端：主进程 provider 层 + IPC + 流式 + 本地库 | ① 主进程统一收发流、渲染层只消费事件；② 流式批处理防掉帧；③ provider 抽象（将来多后端可扩展） | 直连各家云 API —— 我们走官方 Harness wire 协议（provider = 本机 harness） |
| claude-desktop-client 系列 | 包装 Anthropic API | 简——只做单 provider 直连 | 无官方边界可复用，参考价值最低 |

**我们的定位 = Cherry Studio 的「单 provider 形态」：provider 不是云 API，而是本机
Harness 的 HTTP/WS 边界。** 收益：无需处理各家 SDK 差异，模型/工具/审批/会话全部
由 Harness 提供，桌面端只做传输与渲染。

## 3. 架构

```
Renderer（自定义壳）                 Main（桌面 Adapter）
┌──────────────────────┐   IPC    ┌──────────────────────────────────┐
│ ChatView / sidebar   │ ◄──────── │ EventStream  ┌─ RpcClient ─────┐ │
│ messageStore.dispatch│ agent:event│ (protocol)   │ fetch POST 上行  │ │
│ 审批卡片 / 问题卡片    │ ────────► │ session cache │ WebSocket 下行  │ │
│ 输入框 send/cancel    │ agent:*   │ event-mapper │ mux + host 双流  │ │
│ (现有 reducer 直接吃) │           │ wire-schema  │ 断线重连控制器     │ │
└──────────────────────┘           └──────────────┴──────────────────┘ │
                                                    │ 127.0.0.1:PORT   │
                                                    ▼                  │
                                          dsh web（官方运行时，不 import）
```

- **RpcClient**（主进程）：fetch（HTTP 上行）+ Node 内置 WebSocket（下行，
  Node 22 自带，零原生依赖）；`rpcId` 由客户端铸造；响应回显匹配。
- **ConnectionController**：仿官方重连语义——断线 → 重开 mux + 用
  `lastSeq` 补拉 history → 去重后重放；乐观用户消息用官方回显的 rpcId 对账。
- **event-mapper**：SessionEvent → `@dshd/protocol` AgentEvent（上表映射，
  zod 宽松校验 + 未知帧容忍）；审批/问题帧保留 rpcId 供响应。
- **IPC**：`agent:event`（主→渲染流式推送，批量合并 30–60ms 后转发）、
  `agent:send` / `agent:cancel` / `agent:approve` / `agent:answer-question`
  （渲染→主，主进程校验后走 RPC）。
- **渲染层**：现有 `messageStore.dispatch` 直接消费，reducer/分支/自定义指令
  全部复用；新增输入框、审批卡片、问题卡片（approvals 状态已预留）。

## 4. 实施里程碑（每步可独立验收）

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M1 传输层** | RpcClient（HTTP+WS 双通道、rpcId 信封、schema 校验）+ 对真实 dsh 实例的契约快照测试（录帧 fixture） | 单测：信封序列化/响应回显/WS 收帧；集成：连真实 dsh 收到 `session/subscribed` |
| **M2 会话域** | sessions.list/create/history 接入 + 本地 SQLite 缓存（复用 session-store）+ 侧栏真实会话列表 | 建会话→列表出现→历史回放一致（含重启恢复） |
| **M3 流式端到端** | agent:send → mux 流 → mapper → IPC → ChatView 打字机渲染 | 真实对话流式渲染；工具调用卡片出现；fixture 回放回归 |
| **M4 交互闭环** | 审批卡片 approve/deny、问题卡片回答（respond 回显 rpcId）、cancel/retry | 触发真实审批 → UI 决策 → 运行继续；取消后状态一致 |
| **M5 韧性** | 断线重连 + lastSeq 断点补齐 + 错误分类映射 + `docs/event-stream-adapter.md` | 杀掉 dsh 再重启 → 流自动恢复且消息不丢不重 |

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| developer-preview 协议漂移（帧形状/事件类型变化） | 契约快照测试钉住当前形状；版本升级必须过 M1 fixture + 全量冒烟（复用 T5.1 门禁） |
| 未知/新事件类型 | `ignorable` 标记 + 协议层 unknown 容忍（已有）；mapper 输出告警日志 |
| token 级 chunk 高频 → IPC 洪泛/掉帧 | 主进程批量合并（30–60ms）后整批推送；渲染层已按序 reducer |
| 审批/问题帧的 rpcId 丢失 → 无法响应 | wire-schema 必填校验；快照测试覆盖 respond 回显 |
| 双实例端口/信任 | 沿用 `--port 0` + loopback Host 信任；宿主流（events.host）仅订阅不依赖 |

## 6. 文件落点

```
apps/desktop/electron/adapter/
  rpc-client.ts            # HTTP+WS 双通道，rpcId 信封
  wire-schema.ts           # zod 宽松校验 + 帧联合
  connection-controller.ts # 重连 + lastSeq 断点补齐
  event-mapper.ts          # SessionEvent → @dshd/protocol
  session-cache.ts         # list/history 本地缓存
  adapter.test.ts          # 契约快照 + fixture 回放
packages/protocol/src/events.ts  # 新增 'question' 事件类型（含 rpcId 通道）
tests/fixtures/events/     # 扩充真实帧录制（mux/subscribed/approval/question）
```

## 7. 决策点（需你拍板）

1. **M1 起步方式**：直接按上述契约实现（推荐，证据充分）还是先写一个 15 分钟
   的"探针脚本"连真实 dsh 录一帧真实流量再动工（更稳，多半天）？
2. **侧栏会话列表**：M2 先做「只读列表 + 历史回放」，写操作（改名/删除/搜索）
   放 M2 之后？还是 M2 一次做全？
