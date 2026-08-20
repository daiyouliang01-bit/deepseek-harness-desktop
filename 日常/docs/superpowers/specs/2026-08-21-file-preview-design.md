# dsh-file-preview 设计文档

- 日期：2026-08-21
- 状态：待用户审阅
- 目标载体：DeepSeek Harness Desktop（dsh web profile，macOS）

## 1. 背景与目标

在 DeepSeek Harness Desktop 桌面端增加**文件预览**能力：用户能从文件树或手动路径打开文件，在**右侧详情区域**以**多标签页**方式预览。参考 GitHub 的文件浏览体验（文件树 → 点击 → 内容区按类型渲染）与 VS Code 的多标签切换（tab bar + 关闭 + 切换）。

支持的预览类型：Markdown、纯文本、代码、PDF、图片、本地网页（HTML）、docx（textutil 内联转换）。

## 2. 参考设计（GitHub）

GitHub 仓库文件页的成熟设计要素，本方案吸收的部分：

| GitHub 要素 | 本方案对应 |
| --- | --- |
| 左侧文件树，点击导航 | 侧边栏「文件」按钮 → 抽屉文件树（可固定） |
| 内容区按类型渲染（md 富文本 / 代码高亮 / PDF 内嵌 / 图片直显 / HTML 预览） | 右侧多标签面板内容区，同类型分派 |
| 面包屑 / 工具栏（raw、下载、在编辑器打开） | 标签页工具栏：在默认应用中打开、复制路径、刷新、关闭 |
| 加载态 / 空状态 / 错误态 | 面板内统一三态 |
| 安全的 HTML 预览（沙箱） | iframe sandbox 渲染 |

差异：GitHub 单文件页，本方案按用户要求为**多标签**（VS Code 式）。

## 3. 已确认的需求决策

| 决策点 | 结论 |
| --- | --- |
| 预览位置 | 右侧详情区域（details 列），多文件标签切换 |
| 文件来源 | 文件树为主 + 手动打开任意路径 |
| 实现载体 | 独立插件包 `dsh-file-preview`（`~/.dsh/plugins/`），仿 genui 结构 |
| 文件树入口 | 侧边栏底部「文件」按钮 → 抽屉，抽屉**可固定**为常驻 |
| docx 处理 | macOS `textutil` 转 HTML 内联预览 + 工具栏「用默认应用打开」 |

## 4. 架构概览

双面 Cordis 插件包（参照 `@omdsh-dev/dsh-genui` 结构）：

```
dsh-file-preview/
├── package.json          # 双面导出：main=lib/index.js(host) + ./client=lib/client.js(browser)
├── cordis.patch.yml      # 注册行：- id: file-preview, name: '@dshd/dsh-file-preview'
├── tsdown.config.ts      # 构建（rm -rf lib && tsc && tsdown）
├── src/
│   ├── plugin/           # Host 半（Node 侧）
│   │   ├── index.ts      # apply(ctx)：注册 webServer 路由 + RPC handler
│   │   ├── preview-route.ts   # /preview/* 流式文件输出
│   │   ├── rpc.ts        # listDir / readText / stat / docxToHtml / openInApp
│   │   └── convert.ts    # textutil 转换封装
│   └── client/           # Client 半（浏览器侧）
│       ├── index.tsx     # slots 注册：sidebar.footer.action + details + overlay 抽屉
│       ├── file-tree.tsx # 文件树组件（展开/收起/图标/双击打开）
│       ├── preview-panel.tsx # 多标签面板（tab bar + 内容区 + 工具栏 + 三态）
│       ├── tabs.tsx      # 标签状态管理（打开/切换/关闭/激活）
│       ├── renderers/    # md.tsx(轻量md) code.tsx pdf.tsx image.tsx html.tsx docx.tsx binary.tsx
│       └── md-render.ts  # 无依赖轻量 markdown 渲染器（标题/列表/代码/表格/链接/图片/引用/粗斜体）
└── lib/                  # 构建产物（lib/index.js + lib/client.js）
```

## 5. Host 半设计

### 5.1 预览 URL 通道（webServer 前缀路由）

```
webServer.register({
  kind: 'prefix',
  path: '/preview/',
  handler: async (req, res) => { ... },
})
```

- 请求形式：`/preview/<url-encoded-absolute-path>?t=<mtime>`（`t` 用于缓存失效）
- 行为：`fs.stat` 确认存在且为普通文件 → 按扩展名映射 Content-Type → 流式输出
- Content-Type 映射：`.md → text/markdown`、`.pdf → application/pdf`、`.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp`、`.html/.htm → text/html`、其余文本按 utf-8，未知二进制 `application/octet-stream`
- 响应头：`Content-Length`、`Cache-Control: private, max-age=0, must-revalidate`（本地文件随时可改）、`X-Content-Type-Options: nosniff`
- **不实现** Range/206（PDF 较小场景够用；大 PDF 依赖浏览器自身加载，MVP 接受整文件输出）

### 5.2 RPC 方法（harness.handle）

| 方法 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `fp.listDir` | `{ path }` | `[{ name, path, isDir, size, mtime }]` | 目录条目，目录优先排序 |
| `fp.readText` | `{ path, maxBytes? }` | `{ text, truncated, mtime }` | UTF-8 读取，默认上限 2MB，超出截断并标记 |
| `fp.stat` | `{ path }` | `{ exists, isDir, size, mtime, ext }` | 打开前校验 |
| `fp.docxToHtml` | `{ path }` | `{ html, error? }` | textutil 转 HTML |
| `fp.openInApp` | `{ path }` | `{ ok, error? }` | `open <path>` 系统默认应用 |
| `fp.pickFile` | `{}` | `{ path } | null` | macOS 原生文件选择框（osascript choose file） |

- 所有方法路径参数必须为**绝对路径**，`resolve()` 后校验仍在允许根内（见 §8 安全）
- 读取文件使用 Host `fs` 服务（若可用）或 `node:fs/promises`（Host 半为 Node 环境）

### 5.3 docx 转换

- 临时目录：`os.tmpdir()/dsh-file-preview/`
- 命令：`textutil -convert html -output <tmp>/<hash>.html <path>`（macOS 原生，支持 docx/doc/rtf）
- 输出 HTML 内联样式，Client 端以 `dangerouslySetInnerHTML` 或 iframe `srcdoc` 渲染
- 失败（如非 docx 家族）→ 返回 `error`，Client 显示错误态 + 「用默认应用打开」

## 6. Client 半设计

### 6.1 Slot 注册

| Slot | 用途 | 方式 |
| --- | --- | --- |
| `sidebar.footer.action` | 「文件」按钮（id: `file-preview-open`） | `slots.register` list 条目 |
| `shell.overlay` | 文件树抽屉（id: `file-preview-drawer`） | `slots.register` overlay 条目，面板自身管理显隐 |
| `details` | 多标签预览面板（id: `file-preview-details`） | `slots.register`，右侧详情列 occupant |

- **details 列冲突**：`details` 是 single slot，现有 occupant（工具详情）会被替换。方案：预览面板注册为 `details` occupant，但**在无打开文件时渲染「空态 + 提示切换到工具详情」**；`layout.openDetails()` 由「文件」按钮或标签打开动作触发。若实现中发现替换工具详情不可接受，回退到 `shell.overlay` 右侧浮层（见 §10 风险）。
- 抽屉「固定」：固定在 sidebar 区域时，将抽屉内容改挂到 `sidebar.workspaces` 下方不可行（single slot），改为 overlay 常驻定位（`position: fixed` 吸附侧边栏右缘），不改变 slot 归属。

### 6.2 多标签面板状态（tabs.tsx）

```
interface PreviewTab { id; path; name; kind; openedAt }
interface PanelState { tabs: PreviewTab[]; activeId: string | null }
```

- 打开：点击文件树文件 / 手动选择 → `fp.stat` 校验 → 若已在标签中则激活，否则追加并激活
- 切换：点击 tab 激活
- 关闭：× 按钮关闭；关闭激活 tab 后激活相邻 tab
- 上限：最多 8 个标签（防资源滥用，超出时 toast 提示）
- 状态保存在 Client 插件内存中（进程内，重启即清，MVP 不做持久化）

### 6.3 内容区渲染分派

| kind | 渲染器 | 数据通道 |
| --- | --- | --- |
| `md` / `txt` | md-render.ts → 富文本 | `fp.readText` |
| 代码（常见扩展名集合） | `<pre>` + 行号 + 极简关键词高亮 | `fp.readText` |
| `pdf` | `<iframe src="/preview/...">`（Chromium 内置 PDF viewer） | 预览 URL |
| 图片 | `<img src="/preview/...">`，object-fit contain | 预览 URL |
| `html` | `<iframe sandbox src="/preview/...">`（sandbox 无 allow-scripts 外的权限） | 预览 URL |
| `docx` | `fp.docxToHtml` → 渲染 HTML | RPC |
| 未知二进制 | 文件信息 + 「在默认应用中打开」按钮 | `fp.stat` |

### 6.4 三态

- **加载中**：骨架屏 / spinner
- **空态**：无标签时提示「从文件树或手动打开一个文件」
- **错误态**：文件不存在 / 读取失败 / 转换失败，显示原因 + 操作按钮（用默认应用打开）

### 6.5 工具栏（标签页内）

- 「在默认应用中打开」：`fp.openInApp`
- 「复制路径」：`navigator.clipboard.writeText`
- 「刷新」：重新触发当前渲染器
- 「关闭」：关闭当前标签

## 7. 数据流

```
用户点击侧边栏「文件」按钮
  → slots 渲染 overlay 文件树抽屉（懒加载根目录 = 当前 workspace 根）
  → fp.listDir 逐级展开
  → 点击文件 → fp.stat → 打开/激活标签
  → 标签激活 → 按 kind 分派渲染器
       ├─ 文本类 → fp.readText → 渲染
       ├─ 预览 URL 类 → iframe/img src=/preview/<path>
       └─ docx → fp.docxToHtml → 渲染
  → 手动打开：fp.pickFile（osascript 原生选择）→ 同上
```

## 8. 错误处理与安全

- **路径校验**：RPC 与预览路由都要求绝对路径且 `resolve()` 后不得越出 `允许根`（允许根 = 当前 workspace 根 + 用户通过 pickFile 明确选择的路径）。MVP 简化：允许根 = workspace 根；手动打开任意路径需经 `pickFile`（用户显式授权）。
- **workspace 根获取**：Host 半在 `apply(ctx)` 时读取 `ctx.get('workspaces')` 的当前工作区根（启动时注入的 cwd），或回退 `process.cwd()`；文件树根目录即该值。若运行时 workspace 切换，`fp.listDir` 以显式传入的根为准（Client 每次从 Host 重新获取当前根）。
- **目录穿越**：预览 URL 解码后 resolve，拒绝 `..` 越界。
- **大文件**：`readText` 2MB 截断；预览 URL 流式输出不截断。
- **HTML 沙箱**：iframe `sandbox` 属性，不允许 `allow-scripts` 以外权限（默认无 `allow-same-origin`，避免本地文件脚本访问其它本地文件）。
- **RPC 失败**：统一 `{ error }` 返回，Client 显示错误态，不抛未捕获异常。
- **textutil 缺失**：macOS 必有；若命令失败返回 error。

## 9. 测试策略

- Host 半单测（vitest）：`listDir` 排序、`readText` 截断、路径校验拒绝越界、预览路由 Content-Type 映射、docx 转换成功/失败路径
- Client 半：标签状态机单测（打开/去重激活/关闭/相邻激活/上限）
- 手动验证清单（桌面端重启后）：
  1. 侧边栏出现「文件」按钮 → 抽屉展开/收起/固定
  2. md 渲染标题/列表/代码块/表格
  3. PDF 内嵌滚动
  4. 图片直显
  5. 本地 html 沙箱渲染
  6. docx 内联 + 外部打开
  7. 多标签切换/关闭
  8. 手动 pickFile 打开

## 10. 风险与权衡

| 风险 | 缓解 |
| --- | --- |
| `details` single slot 替换工具详情 | 空态引导；若不可接受回退 overlay 右侧浮层 |
| Client bundle 需 tsdown 构建（参照 genui，构建链已验证） | 复用 genui 的 tsdown.config.ts 模板 |
| 动态插件通道当前故障（cordis_define 参数 bug） | 本方案走静态包 + patch 注册，不依赖动态通道 |
| PDF Range 请求缺失 | 小 PDF 无碍；大 PDF 标记为已知限制，后续可加 206 |
| markdown 渲染器为自研轻量版 | 覆盖常见语法；复杂表格/脚注等降级为纯文本 |

## 11. 范围外（YAGNI）

- 标签拖拽排序、标签持久化（重启保留）
- 图片/PDF 缩略图预览、文件搜索
- 语法高亮完整化（highlight.js 等重型库）
- 文件编辑/保存
- 远程文件系统（SFTP 等）

## 12. 实施步骤概要（待 writing-plans 细化）

1. `~/.dsh/plugins/dsh-file-preview/` 初始化包（package.json / tsdown / cordis.patch.yml）
2. Host 半：preview 路由 + RPC + docx 转换
3. Client 半：文件树抽屉 + 多标签面板 + 渲染器
4. 构建 + 单测
5. `dsh plugin add link:...` 注册到 web profile
6. 重启桌面端，按 §9 清单手动验证
