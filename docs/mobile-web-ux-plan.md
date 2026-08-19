# 网页端手机交互优化方案

> 版本：v1.1（v1.0 实测稿 + 第 1–2 轮对抗合并 R1–R14）
> 状态：计划（已用 iPhone 14 视口对运行实例实测，未实现）
> 时间：2026-08-19
> 实测对象：`127.0.0.1:35880` 官方 Web UI、`35880/phn` 手机控制台、`35881` PIN 门

---

## 0. 结论先行

手机经隧道进来后，**默认看到的是官方 Web UI 全量桌面壳**（PIN 门 `allowFullApp` 默认为 true），不是 `/phn`。所以「网页端交互」= 390px 下的官方 UI，外加一条本应兜底、但现在是坏的 `/phn`。

实测三页：

| 表面 | 结果 | 用户能做什么 |
|------|------|----------------|
| 官方 Web（iPhone 14，390×664） | 能看见输入框，能打字 | 侧栏 rail + 底栏挤成一团；「社区」竖排成「社/区」；设置无法深链 |
| `/phn` 手机控制台 | **脚本解析失败，永久「加载中…」** | 不能看会话、不能发消息 |
| PIN 门（35881） | 可用 | 输错 PIN 有提示；未设 PIN 与错 PIN 都显示「PIN 错误」 |

**本方案只改交互与手机页可用性，不改鉴权模型**：公网仍走 PIN 门；companion token 仍只由门注入，不进仓库、不进前端 JS。

红线：

1. 不把 `DSH_COMPANION_TOKEN` 写进页面或 localStorage。
2. 不削弱 PIN；未设 PIN 时公网仍不可进（与既有 R1/R30 一致）。
3. 不重启/替换当前正在服务会话的 35880 进程来「验证」。
4. 官方 UI 的桌面布局不得被手机 CSS 误伤（只在窄视口生效）。

---

## 1. 实测记录（环境真相）

方法：Playwright Chromium + `devices['iPhone 14']`，截图在 `/tmp/dsh-mobile-ux/`。

### 1.1 官方 Web `http://127.0.0.1:35880/`

- 视口 390×664，无横向滚动。
- 左侧 rail 仍在：新建 / SSH / 技能 / 工作区 / 搜索 / 检查更新 / 社区 / 设置。
- 「社区」锚点实测 **32×65**，文字被竖排成「社 / 区」，和下载图标抢位。
- 大量主操作低于 44px：发送 34×34、命令 28×28、关闭详情 28×28、设置关闭 18×18。
- `#settings` **不会打开设置页**（hash 被忽略）。
- 输入框 16px，避开 iOS 聚焦放大，这项是对的。
- 控制台有一条 404（静态资源），无 pageerror。

### 1.2 `/phn` 手机控制台

- HTML 能返回（注意：`/phn/` 带尾斜杠会落到官方 SPA，见 R6）。
- 页面脚本：`SyntaxError: missing ) after argument list`，随后 `setMode is not defined`。
- 根因：手机 HTML 写在 `lib/index.js` 的 **template literal** 里，源码 `\'` 被吃掉，浏览器收到：

```js
sessions.map(s=>'<li onclick="openS(''+s.id+'')"><span
```

合法意图是 `openS('"+s.id+"')`。脚本整段作废，`onHash()` 从未执行，于是永远「加载中…」。

- 即便脚本修好：直连 35880 的 `fetch('/phn/api/sessions')` **没有 companion header → 401**。PIN 门代理会注入 header（`pin-gate.ts` 388/451 行），所以**真机经隧道+PIN 后 API 能通**；直连环回不能当验收标准。
- 401 时前端会把 `{error}` 当成空列表，显示「暂无会话」，而不是「未授权」（R7）。

### 1.3 PIN 门 `http://127.0.0.1:35881/phn`

- 卡片居中、解锁按钮够大、密码框 16px。通过。
- 输入 `0000` → 「PIN 错误」。未设 PIN 时 `verify()` 恒 false，文案无法区分「还没设」和「输错了」（有意不在公网暴露是否已设，可接受）。
- 中文缺空格：「保护,请」。

---

## 2. 目标与非目标

### 目标（手机 15 秒内能续聊）

1. 经 PIN 进入后，主路径是「会话列表 → 打开一条 → 看回复 → 发一条 → 返回列表」，每步可回退。
2. 官方 Web 在 ≤430px 时：对话区优先，rail 可收，底栏不竖排、不互相重叠。
3. `/phn` 脚本可解析、列表能出来、浏览器返回键有效。
4. 回归：现有 electron 单测 + 一条不启动完整 UI 的 `/phn` 脚本语法/报价测试。

### 非目标

- 不做原生 App / PWA 安装营销（可后补 manifest）。
- 不把 better-sidebar / SSH / 技能中心做成手机版（窄屏隐藏入口即可）。
- 不改 PIN 哈希、不改 companion 协议。
- 不默认把公网改成只出 `/phn`（`allowFullApp` 保持现状，另给「打开简洁手机页」入口）。

---

## 3. 架构（两层，互不替代）

```
手机浏览器
    │  Cloudflare 隧道
    ▼
PIN 门 :35881  ──注入 x-dsh-companion-token──►  dsh web :35880
    │                                              │
    │  allowFullApp=true（现状）                    ├─ 官方 Web UI（窄屏皮肤）
    └─ /phn  （简洁控制台，修复后作备用）            └─ /phn 静态页 + /phn/api/*
```

官方 UI 负责「和桌面同一套会话」。`/phn` 负责弱网/只想看聊天。两条都要能回退到列表/设置，禁止再 `loadURL` 整页跳走。

---

## 4. 分阶段改动

### P0 — 修好 `/phn`（否则备用路径是死的）

**R1 🔴 模板字符串转义把页面 JS 写坏**

- 把手机页从 `lib/index.js` 内联 HTML **抽到** `plugins/phone-sync/assets/phn.html`（外链 `phn.css` / `phn.js`）。
- host 只 `readFile` 静态资源，不再拼接脚本。
- 验收：`node --check assets/phn.js`；用 Playwright 打开 `/phn` 不再出现 `SyntaxError`。

**R2 🔴 `/phn/` 尾斜杠落到官方 SPA**

- 同时注册 `/phn` 与 `/phn/`，或 301 `/phn/` → `/phn`。
- PIN 门已 302 到 `/phn`（无斜杠），补这一刀防书签/自动补全。

**R6 🟡 列表项 `onclick="openS('id')"`**

- 抽文件后改成 `data-id` + 事件委托，禁止把 session id 拼进内联 handler（防引号 XSS）。

**R7 🟡 401 被显示成「暂无会话」**

- `fetch` 检查 `r.ok`；401/403 文案：「未通过桌面 PIN 门，请从隧道地址打开」。
- 环回直连 35880 允许失败，不作为手机验收。

**R8 🟡 浏览器返回无效**

- 列表 ↔ 详情用 `pushState` + `popstate`，不要只用 `replaceState`。
- 「‹ 返回」调用 `history.back()`，没有历史再渲染列表。

**R9 🟢 工具条点击面积**

- 「重要内容 / 完整」改为 ≥44px 的 `button`，不要 25px 的 `span`。

**R10 🟢 发送区**

- `textarea` + 发送同一行；`enterkeyhint="send"`；`visualViewport` 避开 iOS 键盘遮挡。
- 非 live 会话：按钮禁用并写「该会话未在桌面运行，无法续聊」（对应现有 404 `session not live`）。

### P1 — 官方 Web 窄屏（手机真实主路径）

触发：`max-width: 430px`（含 390 的 iPhone 14）。只动 CSS / 少量 client 插件，不改官方壳源码。

**R3 🟡 底栏「社区」竖排**

- `@dshd/community-links` 的 footer 在窄屏只显示地球图标，`aria-label="社区"`，最小 44×44。
- 不再用「🌐 社区」长文案挤 rail。

**R4 🟡 桌面插件入口抢宽度**

- 窄屏隐藏：SSH、技能中心、检查更新图标的文字；better-sidebar 默认不占右栏。
- 「详情」默认关闭（已打开则保留，不强制关正在用的桌面窗）。

**R5 🟡 设置打不开**

- 设置仍走官方齿轮。给 `phone-settings` / `community-links` 各加一条：窄屏下 `settings.section` 的入口足够大。
- 不依赖 `#settings` hash（官方没有这条路由，R11：不要自己发明 hash 协议去撞壳）。

**R12 🟢 点击热区**

- 发送 / 新建 / 设置：窄屏 `min-width/min-height: 44px`。只覆盖我们自己的插件与 phone 页；官方按钮能改则改，不能改就不动（避免和上游 CSS 打仗）。

### P2 — PIN 门文案（小）

**R13 🟢** 「此实例受 PIN 保护,请输入访问密码」→ 加空格「保护，请」。不提示是否已设 PIN。

### 明确不追

- 官方 UI 完整变成原生 App 级导航（成本高，且和 `/phn` 重复）。
- 在 `/phn` 页面里发 companion token（违反红线 1）。
- 改 `allowFullApp` 默认值（会改变已习惯「手机上看完整 UI」的人；需要的话另开开关，不塞进本方案）。

---

## 5. 实现落点（文件）

| 改动 | 位置 |
|------|------|
| 抽出手机页 | `apps/desktop/plugins/phone-sync/assets/phn.{html,css,js}` |
| 静态路由 | `apps/desktop/plugins/phone-sync/lib/index.js` |
| 社区底栏窄屏 | `apps/desktop/plugins/community-links/lib/client.js` |
| PIN 文案 | `apps/desktop/electron/runtime/pin-gate.ts`（及对应单测） |
| 报价/语法回归 | `apps/desktop/plugins/phone-sync/phn-page.test.ts`（读 assets/phn.js `node --check` + 禁止 template 内联脚本的 grep） |

不改 `~/.dsh`、不改已推送无关的 `desktop-tools.patch.yml`。

---

## 6. 验收（可测）

1. `node --check apps/desktop/plugins/phone-sync/assets/phn.js` 退出 0。
2. Playwright iPhone 14 打开 `/phn`：无 `SyntaxError`；可见「暂无会话」或会话列表，不再永久「加载中…」。
3. 带 token 的请求（模拟 PIN 门 header）能列出当前 profile 会话；点进一条有「‹ 返回」；`history.back()` 回到列表。
4. 401 显示未授权，不显示空列表。
5. iPhone 14 打开官方 UI：「社区」不再竖排；底栏图标 ≥44px。
6. 既有 `vitest run electron` 安装器/PIN 门用例不回退。
7. 仓库 diff 不含密钥、PIN、companion 明文。

---

## 7. 对抗摘要

### 第 1 轮（挑刺）

| ID | 级 | 发现 | 已并入 |
|----|----|------|--------|
| R1 | 🔴 | template `\'` 写坏 `/phn` JS | §4 P0 抽静态文件 |
| R2 | 🔴 | `/phn/` 变成官方 SPA | §4 双路径/重定向 |
| R3 | 🟡 | 社区竖排 | §4 P1 |
| R4 | 🟡 | 桌面插件入口挤手机 | §4 P1 窄屏隐藏 |
| R5 | 🟡 | `#settings` 无效 | 不发明 hash，走齿轮 |
| R6 | 🟡 | onclick 拼 id | 事件委托 |
| R7 | 🟡 | 401→空列表 | 显式错误 |
| R8 | 🟡 | replaceState 无法返回 | pushState + back |
| R9–R10 | 🟢 | 工具条/发送区 | P0 |
| R11 | 🟢 | 不要自造 `#settings` | P1 |
| R12 | 🟢 | 44px 热区 | P1 |
| R13 | 🟢 | PIN 文案逗号 | P2 |

### 第 2 轮（重推演）

- 先抽 `/phn` 再改官方 CSS：否则手机备用路径一直死，P1 再翻车无退路。
- 鉴权验收必须以「经 PIN 门」为准，不能用 35880 直连当失败证据去「放宽 token」（那会把环回 API 暴露给本机任意进程）。
- `allowFullApp=true` 不是 bug，是现状；方案同时修两条表面，避免「只修 /phn、真机仍看全 UI」或相反。

### 第 3–5 轮

纸面未再挖出新的 🔴。进入实现后用 §6 清单实测闭环，不再空转纸面轮次。

残余风险（接受）：

- 官方发送按钮 34px 若被上游锁死，本方案只保证我们自己的入口 44px。
- iOS 安全区 / 键盘高度因 WebView 而异，P0 用 `visualViewport`，极端刘海机需真机再调。
- `allowFullApp=true` 时用户仍可能觉得「怎么不是那个深色列表」——设置 → 手机 里加「打开简洁页 `/phn`」链接即可（实现时顺手，不单独立项）。

---

## 8. 建议

**可以开始实现。** 顺序：P0（`/phn` 起死）→ P1（官方窄屏）→ P2（PIN 文案）。实现后按 multi-round 技能做一次子代理 diff 评审再提交。
