# 手机端会话栏与窄屏交互适配方案

> 版本：v1.4（v1.3 + R23–R25：桌面侧栏「固定死」三件套，toggle 防双击翻回去）
> 状态：计划（已用 iPhone 14 视口对运行中的 `127.0.0.1:35880` 实测，**未实现**）
> 时间：2026-08-20
> 实测对象：官方 Web UI（本 GUI），非 `/phn`
>
> *修订记录：v1.0（初稿） → v1.1（R1–R12） → v1.2（R13–R18） → v1.3（R19–R22：桌面钉死 / 手机可收） → v1.4（R23–R25：桌面固定死 = 藏钮 + 同步拉回 + min-width 280；禁止写死详情列为 0）*

---

## 0. 结论先行

手机上「左侧会话栏占掉大半屏幕」**不是官方壳没有窄屏布局**，而是 `@dshd/phone-settings` 在**所有视口**对抗官方布局：藏掉折叠钮，并每 800ms 强制展开。这在桌面是符合产品预期的「钉死」；搬到手机上就把 72% 的屏抢走了。

**产品分流（v1.3 红线，两端不得同一套策略）：**

| 表面 | 左侧会话栏 | 折叠钮 | 默认 |
|------|------------|--------|------|
| **桌面端** | **固定展开**（不允许收成 56px 轨道） | 隐藏 | 280px 三栏 |
| **手机端** | **可以收起** | 可见 | 官方自动收成 56px 轨道；展开则走抽屉 |

官方合同（供手机端复用，桌面端要压住）：

| 常量 | 值 | 含义 |
|------|----|------|
| `SIDEBAR_DEFAULT` | 280px | 展开默认宽 |
| `SIDEBAR_COLLAPSED` | 56px | 收起后的图标轨道 |
| `SIDEBAR_AUTO_COLLAPSE` | 1024px | 低于此视口官方**自动收起** |
| `CENTER_MIN` | 640px | 让步链保中栏；侧栏永不让步 |

390px iPhone 上官方默认应是 **56px 轨道 + 334px 对话区**。插件无差别钉死后对话区只剩 110px。

**本方案主路径：桌面继续钉死；手机停止对抗，交还给官方自动收起；手机上再补「展开=抽屉」。** 不改 `@deepseek-ai/*`，不改鉴权，不重启正在服务的 35880 进程来验证。

红线：

1. 不修改 `@deepseek-ai/*` 源码或官方 preset。
2. 不把 `DSH_COMPANION_TOKEN` / PIN 写进页面或 localStorage。
3. 不重启/替换当前正在服务会话的 35880 进程来「验证」。
4. **桌面端左侧会话栏固定死：用户不能收、官方窄屏自动收也必须被拉回。** 不得把桌面改成可折叠轨道。
5. 手机主路径仍是**完整官方 Web UI**，不用 `/phn` 替换。
6. 判断不确定时**漏钉不误钉**：识别不出桌面 → 当手机，不强制展开。
7. 隐藏折叠钮不得误伤右侧 better-sidebar（其 aria 也是「展开侧边栏」）。
8. 桌面钉死不得写死 `grid-template-columns: 280px 1fr 0`（会把右侧详情栏掐掉）。

---

## 1. 实测记录（环境真相）

方法：Playwright Chromium + `devices['iPhone 14']`（390×844），直连 `http://127.0.0.1:35880/`。截图：`/tmp/dsh-mobile-sidebar/`。

### 1.1 现状（插件对所有视口钉死）

| 指标 | 值 |
|------|----|
| 视口 | 390×844 |
| `grid-template-columns` | `280px 110px 0px` |
| `.pI_x6G_sidebarCol` 宽 | **280px（占屏 72%）** |
| `data-sidebar-collapsed` | 无 |
| `.hHd-Xa_toggle`（aria「收起侧边栏」） | `display: none`，宽 0 |
| 输入框宽 | 68px |
| 中栏文案 | 「探索未至之境」被挤成竖排 |

右侧「展开侧边栏」是 **better-sidebar**（`nArs4W_toggleButton`，28×28），与左侧会话栏不是同一个控件。

### 1.2 对照：仅在该窄屏会话里停掉对抗

去掉 `style[data-plugin="phone-settings"]`，吞掉 interval 对 toggle 的 `click`，再调用一次官方收起：

| 指标 | 值 |
|------|----|
| `data-sidebar-collapsed` | **true** |
| `grid-template-columns` | `56px 334px 0px` |
| 侧栏宽 | **56px** |
| 中栏宽 | **334px** |
| 输入框宽 | **292px** |
| 主区 | hero + 输入框完整可读 |

这是**手机端**目标态。桌面端必须保持 §1.3，不能跟过来。

### 1.3 桌面 1280×800 对照

会话栏 280px + 对话区完整。v1.3 要求：**继续钉死**，折叠钮继续隐藏。不得以「恢复官方折叠」为名让桌面用户把侧栏收成轨道。

### 1.4 官方源码合同（运行中的 dsh-cli）

`dsh-client-ui-layout/lib/client.js`：

- `narrow = viewport < 1024`
- `sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0`
- 初始 `narrowExpanded: false` → 窄屏默认收起（手机要的；桌面要挡住）
- `toggleSidebar` 在 `narrow` 时只翻转 `narrowExpanded`
- 列宽写在 **inline style** `gridTemplateColumns` 上（P1 overlay 必须 `!important`）
- 稳定钩子：`data-sidebar-collapsed`、`data-shell-overlay`、`ctx.layout.toggleSidebar()`

### 1.5 既有测试约束

`apps/desktop/plugins/plugin-sandbox.test.mjs`：

- `effects.length === 1`
- 源码仍须匹配 `/移动端远程控制/` 与 `/display: none/`（隐藏官方重复入口，**保留**）

P0 把钉死 CSS / 手机 CSS 放进**同一个** effect。

---

## 2. 目标与非目标

### 目标

1. **手机（≤430px，无桌面桥）默认：会话栏不占主画面。** 侧栏 ≤ 64px，中栏 ≥ 300px，输入框 ≥ 250px。
2. 手机用户仍能打开完整会话列表，选一条后回到「对话优先」。
3. 手机手动展开时对话区不被挤成竖排（P1 抽屉）。
4. 触控：社区 / 遮罩 / 设置页按钮 ≥44px；官方轨道图标不重画。
5. **桌面端：左侧会话栏固定 280px 展开，折叠钮不可见，用户不能收起。**
6. 回归：`plugin-sandbox.test.mjs` 与既有 electron 安装器/PIN 门用例不回退。

### 非目标

- 不做原生 App / 不把 `/phn` 当主 UI。
- 不把 better-sidebar / SSH / 技能中心做成手机版。
- 不改 PIN、companion、trusted-host、allowFullApp。
- 不把官方 `sidebar` slot 整列替换。
- 不在桌面提供「可折叠侧栏」作为可选项（产品明确固定）。

---

## 3. 路径对比与选定

| 路径 | 做法 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| **A. 分流：桌面钉死 / 手机轨道+抽屉** | 钉死逻辑加 `shouldPinSidebar()` 门；手机停对抗 | 满足产品红线；复用官方窄屏状态机 | 要正确识别桌面 vs 手机 | **选定** |
| A′. 两端都停对抗（v1.2） | 删掉全部强制展开 | 实现最小 | **桌面也可折叠，违反红线 4** | 否决 |
| B. `/phn` 两页 | 简洁控制台 | 触控好 | 与完整 UI 诉求冲突 | 不选 |
| C. 替换 `sidebar` slot | 自绘导航 | 完全可控 | 官方 seats 消失 | 不追 |

分流合同：

```
shouldPinSidebar()
  ├─ window.desktop 存在     → 桌面壳，钉死（即使窗口被缩窄）
  ├─ min-width: 1024         → 宽屏浏览器，钉死
  └─ 其他                    → 手机 / 窄屏浏览器，不钉
                               官方自动收起 + 本方案抽屉

桌面钉死（三件套，缺一不可）
  1. 控件：藏左侧折叠钮，用户点不到
  2. 状态：pin 期间一旦 data-sidebar-collapsed → 同步 toggleSidebar 拉回
     （只在 collapsed===true 时调用，防 toggle 双击又收起）
  3. 样式：侧栏 min-width:280px !important，挡住官方收成 56px 的一帧闪烁
  详情栏宽度仍由官方 inline grid 管，不写死第三列

手机默认                     56 | 中栏 | 0
手机 ≤640 且展开             抽屉 overlay，中栏宽度不掉
```

识别函数（实现必须按此语义，不得只看 UA）：

```js
function shouldPinSidebar() {
  if (typeof window === 'undefined') return false
  if (window.desktop) return true
  return window.matchMedia('(min-width: 1024px)').matches
}
```

---

## 4. 分阶段改动

### P0 — 分流钉死（必须先做，单独可验收）

**R19 🔴 产品：桌面固定、手机可收，禁止同一套处理（v1.3）**

改 `apps/desktop/plugins/phone-settings/lib/client.js` 现有 effect，**不要整段删掉钉死**：

1. **删除**无条件规则与 800ms 轮询：
   - 全局 `.hHd-Xa_toggle { display: none }`
   - `setInterval(..., 800)` + 对 `.hHd-Xa_collapsed` 的 `toggle.click()`
2. **改为桌面「固定死」三件套（R23）**：
   - `applyPin()`：`shouldPinSidebar()` 为真时 `document.documentElement.setAttribute('data-dshd-pin-sidebar', '')`，否则 `removeAttribute`。
   - 监听 `matchMedia('(min-width: 1024px)')` 的 `change`（以及首次 apply）。**禁止 `setInterval`。**
   - **拉回（R25）**：`function pullIfPinned() { if (!shouldPinSidebar()) return; const frame = document.querySelector('[class*="_frame"]'); if (!frame || !frame.hasAttribute('data-sidebar-collapsed')) return; ctx.get('layout')?.toggleSidebar(); }`
     只在 `data-sidebar-collapsed` **存在**时调用。`toggleSidebar` 是翻转，乱调会把已展开的再收起来。
   - MutationObserver 观察 frame 的 `data-sidebar-collapsed` 属性；`shouldPinSidebar()` 为假时 return。
   - 禁止 `.click()` 哈希钮。
3. CSS（同一 style 标签）：

```css
/* 只藏左侧会话栏折叠钮，不藏 better-sidebar */
html[data-dshd-pin-sidebar] [class*="_sidebarCol"] [class*="_toggle"] {
  display: none !important;
}
/* 锁宽：官方缩到 56px 时这一列也不得小于 280 */
html[data-dshd-pin-sidebar] [class*="_sidebarCol"] {
  min-width: 280px !important;
}
```

**R24 🔴 禁止**用 `grid-template-columns: 280px minmax(0,1fr) 0px !important` 钉死桌面——第三列写 0 会关掉详情栏。桌面 grid 仍交给官方，只锁第一列下限。

**保留**隐藏「移动端远程控制 / 检查更新」的选择器。

**R1 🔴 行为禁止哈希类名**

- 拉回只用 `ctx.layout.toggleSidebar()`。
- 钉死状态用 `data-dshd-pin-sidebar` + `data-sidebar-collapsed`。
- 允许 `[class*="_sidebarCol"] [class*="_toggle"]` 做 CSS 隐藏（scoped，避开 better-sidebar）。

**R20 🟡 Electron 开设备模式仍会钉死**

- `window.desktop` 在桌面壳里恒真，DevTools iPhone 模式仍走桌面。接受：真机 / Playwright（无 preload）才是手机验收。不要为了方便调试在桌面壳里放行折叠。

**R21 🟡 禁止用 aria「展开侧边栏」做隐藏**

- 右侧 better-sidebar 同文案。必须限定在 `_sidebarCol` 内。

**R13 🟡 `effects.length === 1`**

- 钉死 + 手机 CSS 仍在同一个 `ctx.effect`。observer / matchMedia 的 disposer 放进该 effect 的返回函数。

**R2 修订**（原「删掉全部强制展开」作废）：800ms click 必须删除；桌面钉死改为事件驱动拉回。

验收（P0 单独）：

- Playwright iPhone 14（无 `window.desktop`），等 2s：侧栏 ≤64px，中栏 ≥300px，输入框 ≥250px，`data-sidebar-collapsed` 为 true，**没有** `data-dshd-pin-sidebar`。
- 1280px 且视为桌面：侧栏约 280px，存在 `data-dshd-pin-sidebar`，左侧折叠钮不可点/不可见。
- 源码不再出现 `setInterval` 与 `hHd-Xa_collapsed` 的 `click`。

### P1 — 仅手机：展开改为抽屉

**R3 🔴 官方 `narrowExpanded` 仍走 grid 分栏，390px 会再次挤死中栏**

规则必须带 `!important`，且 **只在未钉死时生效**（桌面不得变抽屉）：

```css
@media (max-width: 640px) {
  html:not([data-dshd-pin-sidebar]) [class*="_frame"]:not([data-sidebar-collapsed]) {
    grid-template-columns: 56px minmax(0, 1fr) 0px !important;
  }
  html:not([data-dshd-pin-sidebar]) [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] {
    position: absolute;
    z-index: 40;
    left: 0; top: 0; bottom: 0;
    width: min(320px, 86vw) !important;
    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.28);
  }
}
```

断点 640px = `CENTER_MIN`。桌面有 `data-dshd-pin-sidebar` 时选择器全不匹配。

**R14 🟡 遮罩**

- `shell.overlay` 注册遮罩。
- 可见条件：`!shouldPinSidebar() && !data-sidebar-collapsed && matchMedia('(max-width: 640px)')`。
- 点击 `ctx.get('layout')?.toggleSidebar()`；layout 未就绪则 no-op。
- 子节点必须显式 `pointer-events: auto`。

**R15 🟡 选中会话后收起抽屉（仅手机）**

- `shouldPinSidebar()` 为真时不绑定。
- capture click：会话行 / 「新会话」→ `toggleSidebar()`；搜索/视图/添加工作区不收起。
- 识别失败只靠遮罩（不误收）。

**R17 🟢 抽屉打开时锁 frame 滚动**（不改 `body`）。

### P2 — 其余手机交互

**R6 🟡 56px 轨道里「🌐 社区」竖排**

- 仅当**未钉死且** `data-sidebar-collapsed`（或 max-width 1024 且无 pin）时只渲染地球图标，`aria-label="社区"`，≥44×44。
- 桌面展开态仍显示「🌐 社区」。

**R8–R10、R18** 同 v1.2：热区、键盘尽力而为、不主动打开 better-sidebar、PIN 文案不在本方案必做。

---

## 5. 实现落点

| 改动 | 位置 |
|------|------|
| `shouldPinSidebar` + 属性 + 事件驱动拉回 | `apps/desktop/plugins/phone-settings/lib/client.js` |
| 删除 800ms click / 全局藏钮 | 同上 |
| 手机抽屉 CSS（`:not([data-dshd-pin-sidebar])`） | 同上同一 effect |
| 遮罩 + 选会话收起 | 同上 `shell.overlay`；`ctx.get('layout')` |
| 社区图标 | `apps/desktop/plugins/community-links/lib/client.js` `FooterAction` |
| 回归测试 | `plugin-sandbox.test.mjs`：禁止 `setInterval` / `hHd-Xa_collapsed`+`click`；仍匹配 `移动端远程控制` 与 `display: none`；`effects.length === 1`；源码含 `shouldPinSidebar` 或 `data-dshd-pin-sidebar` |

不改：`~/.dsh*`、官方包、`pin-gate.ts`、`phone-sync`、权限块。

生效：改磁盘 `client.js` 后 **刷新 35880**，不要重启 runtime。

---

## 6. 验收（可测）

| # | 场景 | 期望 |
|---|------|------|
| A1 | iPhone 14 / 390×844，无 `window.desktop`，等 2s | 侧栏 ≤64px，中栏 ≥300px，输入框 ≥250px，无 pin 属性 |
| A2 | 手机点轨道展开 | ≤640px 抽屉盖住中栏，中栏宽 ≥250px |
| A3 | 点遮罩 | 抽屉关，回到 A1 |
| A4 | 展开后点一条会话 | 抽屉关（失败则遮罩仍能关） |
| A5 | 1280×800 桌面 | 侧栏约 280px，**有** `data-dshd-pin-sidebar`，对话区正常 |
| A6 | 折叠钮 | **桌面隐藏**（左侧）；**手机可见**。右侧「展开侧边栏」两端都在 |
| A7 | 社区 | 手机轨道不竖排「社/区」；桌面仍「🌐 社区」 |
| A8 | vitest plugin-sandbox + installer | 全绿 |
| A9 | git diff | 无密钥 / PIN / companion |
| A10 | 35880 进程 | 验证期间 pid 不变 |
| A11 | 桌面钉死拉回 | 钉死态下若官方短暂 collapsed，一次 `toggleSidebar` 后恢复 280px，无 800ms 循环 |
| A12 | iPhone 横屏 844px，无 desktop 桥 | 仍当手机（844&lt;1024），可收起，不钉死 |
| A13 | 桌面固定死 | 无左侧折叠钮；侧栏宽恒 ≥264px（目标 280）；详情栏仍可打开；缩窄窗口后侧栏不得停在 56px 轨道 |

---

## 7. 对抗摘要

### 第 1 轮（v1.1）

| ID | 级 | 发现 | v1.3 状态 |
|----|----|------|-----------|
| R1 | 🔴 | 哈希类名做 click 会失效 | 拉回改 `ctx.layout` |
| R2 | 🔴 | 800ms 无差别强制展开 | **改为仅桌面事件驱动拉回**，手机不再拉回 |
| R3 | 🔴 | 窄屏展开挤死中栏 | P1 抽屉，且排除 pin |
| R4 | 🟡 | 藏折叠钮无法自救 | **仅桌面继续藏（产品要求）**；手机必须可见 |
| R5–R12 | — | 同 v1.1 | 有效 |

### 第 2 轮（结构）

- v1.2 写「删 interval 桌面仍默认展开」——官方 init 确是 280，但官方在窗口 &lt;1024 会自动收起。桌面壳缩窄窗口时，**没有钉死就会变成手机轨道**，违反红线 4。v1.3 用 `window.desktop` 钉死桌面壳。
- 手机横屏 844 仍 &lt;1024 且无 desktop 桥 → 可收。不要用 768 当断点（横屏会误钉）。
- 验收 A1/A5/A6 必须成对：一边可收、一边钉死。

### 第 3 轮（维度）

| 维度 | 状态 | 说明 |
|------|------|------|
| 安全 | PASS | 不碰 PIN/token |
| 性能 | PASS | 删 800ms 轮询；改为 matchMedia + 条件 MutationObserver |
| 可靠性 | PASS | layout 缺失 no-op；不确定不钉 |
| 可维护性 | PARTIAL | 后缀选择器仍可能改名；失效时桌面折叠钮可能露出来，observer 仍会拉回 |
| 平台 | PASS | 桌面桥 / matchMedia，无 UA 字符串解析 |
| 边界 | PASS | 横屏 844、iPad 768 无桥→手机；Electron 缩窄→仍钉 |

### 第 4–5 轮 + v1.3 新场景

| 场景 | 预期 | 保障 |
|------|------|------|
| 手机隧道页无 `window.desktop` | 不钉，A1 | R19 / 红线 6 |
| Electron 窗口拖到 900px | 仍钉死 | `window.desktop` |
| 宽屏浏览器无桥 | 钉死 | min-width 1024 |
| 窄屏浏览器无桥 | 不钉 | fail-safe |
| DevTools 设备模式（Electron 内） | 仍钉（残余） | R20 接受 |
| 官方 hash 升级 | 拉回仍走 layout | R1 |
| 误用 aria 隐藏 | 可能干掉 better-sidebar | R21 禁止 |
| 无 layout 夹具 | 不 throw | `ctx.get` |
| 旋转 | 手机保持可收 | A12 |
| 桌面缩窄 &lt;1024 | 侧栏仍 ≥264px，不进 56px 轨道 | R23 三件套 + A13 |
| 拉回时误调两次 toggle | 会又收起 | R25：仅 collapsed 时调一次 |
| 写死第三列为 0 | 详情栏消失 | R24 禁止 |

### 残余风险（接受）

- 官方发送 34px、轨道 36px：不改上游。
- Electron 内 DevTools 模拟手机仍钉死（R20）。
- `_sidebarCol` local name 若被官方改掉：抽屉皮肤可能失效，手机 P0 自动收起仍在；桌面折叠钮可能露出来但 observer 仍拉回。
- 抽屉 `min(320px, 86vw)` 在列表模式会盖住大部分屏幕，可接受。

---

## 8. 建议

**可以开始实现。** 顺序：P0（分流钉死，刷新 35880 即可见 A1+A5）→ P1（仅手机抽屉）→ P2（社区竖排）。

P0 预期：把「无条件对抗」改成 `shouldPinSidebar()` 门 + 事件驱动拉回，**不是删掉钉死**。不要在 P0 夹带抽屉。实现后对 diff 做一次子代理代码评审再提交。
