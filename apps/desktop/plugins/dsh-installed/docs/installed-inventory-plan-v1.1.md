# 已安装插件与技能 改造方案 v1.1

> 评审：第 1 轮挑刺 R1–R10 + 第 2 轮重推演 R11–R15 已合并进正文。  
> 红线：不误报更新；不改官方 DSH 包；不自动安装/升级；漏做不误做。

## 目标

去掉本机 GUI 里的**插件市场**和 **1024 Store**，把「设置 → 插件」这一栏改成用户**后来自己装上的插件和技能**账本：列表、简述、检查是否有更新。

官方「插件列表」（Loader 全树）和「插件配置」保留。技能中心侧栏保留（那是管理器，不是市场）。

## 现状

| 入口 | 包 | 位置 | 处置 |
| --- | --- | --- | --- |
| 1024 Store 市场 + 安装/卸载 | `dsh1024` | 设置一级「1024 Store」+ 插件栏 tab `1024store` | **停用行，不卸载包** |
| 社区插件市场网格 | `@linxin666/dsh-client-ui-community-plugins`（web-ui-all 行 `web-ui-community-plugins`） | 设置一级「社区插件」 | **停用行** |
| 外链 1024 / dshfind | `@dshd/community-links` | 设置「社区」+ 侧栏底部 | **去掉市场卡片与 1024 外链** |
| 官方插件列表 | `dsh-client-ui-settings-plugin-inventory` tab `all` order 10 | 设置 → 插件 | **保留** |
| 技能中心 | `@linxin666/dsh-client-ui-skill-explorer` | 侧栏 | **保留** |

## 做法

在桌面插件目录新增 **`@dshd/dsh-installed`**（与 `community-links` 同级），Host 提供只读 HTTP，Client 往 `settings.plugins.tab` 注册 **id=`installed` order=5** 的「已安装」页。

挂载面是 **web profile 的 Host 平面**（跨会话的设置页），不是 agent preset。用 `cordis.patch.yml` 插入新行，并 `disabled: true` 关掉两行市场。不改 shipped preset，不改 `node_modules` 里的官方包。

### 列表口径（「后来自己装的」）

**插件**

1. `profiles/web/package.json` 的 `dependencies`，去掉 `@deepseek-ai/*`（与 dsh1024 `readInstalled` 同一口径）。
2. 另外并入 `node_modules/@dshd/*`（desktop 本地插件：community-links / phone-sync 等只在 patch 里、不在 dependencies）。
3. 按包名去重。描述/版本读已解析的 `package.json`。

**技能**（只扫用户/项目技能根，不扫 bundled / runtime）

- `~/.agents/skills`
- `$DSH_HOME/skills`
- 若请求带了可信 `cwd`：`<cwd>/.agents/skills`、`<cwd>/.dsh/skills`
- 每个含子目录 `SKILL.md` 的条目；描述取 frontmatter `description`，否则空串
- `cwd` 缺失则**跳过项目根**（漏做不误做，R15）

不把官方 Loader 树、系统内置 skill 算进来。

### 检查更新（只检查，不安装）

| origin | 判定 | 远端 |
| --- | --- | --- |
| `file:` / `link:` / 相对路径 | `local` | 不请求 |
| npm 规格（版本、tag、`name@version`） | 比 semver | 仅 `https://registry.npmjs.org/<name>/latest` |
| `github:owner/repo` | 有 version 才比 | npm latest，失败再 GitHub latest release；比不了 → `error` 不是 `available` |
| 技能无 git remote | `local` | 不请求 |
| 技能有 https git remote | 尽力取远端 version/tag | 解析失败 → `error` |

规则：

- 列表 `GET` **绝不访问网络**。
- 「检查更新」是显式 `POST`，并发上限 4，单次超时 8s。
- `compareVersions` 解析失败返回 `null`，状态为 `error`，**永不抛成「有更新」**（R2）。
- 网络/非 HTTPS/非 2xx → `error`。`updateAvailable` 只在两次版本都解析成功且 latest > current 时为 true。
- 不写遥测、不调 1024 API、不改 `package.json`。

### HTTP

- `GET /dsh-installed/list`
- `POST /dsh-installed/check-updates`（same-origin + loopback Host）
- 只绑在 `webServer` 出现之后；重复 path 交给官方 webserver 抛错（本插件独占此前缀）。

### 社区入口

`community-links` 只留 Awesome DSH 与橙皮书。侧栏底部不再指向 deepseek1024.com。

## 不做什么

- 不卸载 `dsh1024` npm 包（可逆，R1）。
- 不一键升级/安装/卸载（用户只要检查）。
- 不改官方「插件列表」实现。
- 不把技能中心拆掉。
- 不在本次重启正在跑的 DSH 进程（避免掐断本会话）。GUI 验证等用户重启后刷新 `http://127.0.0.1:35880`。

## 验收

1. 单测：插件口径、技能扫描、版本比较 fail-safe、路由同源、列表不联网。
2. 停用后：设置里不再出现「1024 Store」分区/tab、不再出现「社区插件」市场网格。
3. 设置 → 插件 最前一栏是「已安装」，含用户插件 + 用户技能 + 简述。
4. 点「检查更新」：本地包显示本地；npm 包能区分最新/可更新/失败；失败条不显示「有更新」。

## 修订

- v1.0 初稿
- v1.1 合并 R1–R15：停用不卸载、更新 fail-safe、@dshd 并入、项目技能缺 cwd 跳过、POST 同源、不自动升级、不重启活进程
- v1.2 代码评审 Minor：IPv6 `::1`、未知规格不默认 npm、同源比 scheme、样式随 Fiber 回收、缺 Origin 的 POST 单测
