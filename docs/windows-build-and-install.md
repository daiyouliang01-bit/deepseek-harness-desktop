# Windows 构建与安装说明 — DeepSeek Harness Desktop

> 桌面版把 dsh 运行时（Node + `@deepseek-ai/dsh`）完整打进应用（自包含运行时，ADR-002）。
> 运行时含平台原生二进制（node-pty / sharp 的 Windows 版、node-win-x64），
> **因此 Windows 版（NSIS `.exe` / `.zip`）必须在 Windows 上构建**——
> macOS 上构建出来的包里会是 darwin 版运行时，装到 Windows 无法启动。

---

## 方式一：GitHub Actions 自动构建（推荐）

仓库 `.github/workflows/ci.yml` 已含 `package-windows` 任务
（`windows-latest`：装依赖 → 构建 → 准备 Windows 自包含运行时 → electron-builder 出 NSIS+zip → 上传产物）。

1. 推送代码到 GitHub 仓库（默认分支 `main`）：
   ```bash
   git add -A
   git commit -m "build(win): Windows NSIS/zip packaging + CI job"
   git push
   ```
2. 打开仓库的 **Actions** 页 → 等待 `CI / package-windows` 跑完（约 5–10 分钟）。
3. 进入该次运行 → **Artifacts** → 下载 `desktop-windows-release`。
4. 解压后得到：
   - `DeepSeek Harness Desktop Setup 0.1.0.exe`（NSIS 安装器）
   - `DeepSeek Harness Desktop-0.1.0-win.zip`（绿色版，解压即用）

> 也可以手动触发：Actions → CI → Run workflow（选分支）。

---

## 方式二：Windows 本机构建

需要：Windows 10/11、Node.js 22（含 npm）、pnpm 11、Git。

```powershell
# 1. 克隆仓库（或拷贝已改好的代码）
git clone https://github.com/daiyouliang01-bit/deepseek-harness-desktop.git
cd deepseek-harness-desktop

# 2. 装依赖
corepack enable                          # 启用 pnpm（或 npm i -g pnpm@11）
pnpm install

# 3. 打包 Windows 版（prepare-runtime --release 会在 Windows 上
#    下载 node-win-x64 并 npm 安装带 Windows 预编译的 dsh 运行时）
pnpm --filter @dshd/desktop package:win
```

产物在 `apps/desktop/release/`：
- `DeepSeek Harness Desktop Setup 0.1.0.exe` — NSIS 安装器
- `DeepSeek Harness Desktop-0.1.0-win.zip` — 绿色版

> 本地构建默认**不签名**（`signAndEditExecutable: false`），SmartScreen 会提示，见下。

---

## 安装说明（NSIS 安装器）

1. 双击 `DeepSeek Harness Desktop Setup 0.1.0.exe`。
2. **SmartScreen 提示**（未签名应用常见）：
   - 点「更多信息」→「仍要运行」；或右键 exe → 属性 → 勾选「解除锁定」→ 确定。
3. 安装向导：选「仅为当前用户安装」，可改安装目录，勾选桌面快捷方式。
4. 安装完成后启动「DeepSeek Harness Desktop」。

### 绿色版（zip）
解压到任意目录（如 `D:\Apps\DeepSeek Harness Desktop\`），
双击 `DeepSeek Harness Desktop.exe` 即可，无需安装。

---

## 首次启动与数据目录

| 事项 | 说明 |
|---|---|
| 数据目录 | 桌面端固定使用 `%USERPROFILE%\.dsh-desktop`（与 3080 网页版 `~/.dsh` 物理隔离，互不写坏会话日志） |
| 自包含运行时 | 应用自带 Node 与 dsh，无需安装 Node / 全局 dsh |
| 自动打开浏览器 | 桌面版已加 `--no-open`，启动只打开应用窗口，不再弹系统浏览器 |
| 语言 | 桌面端默认中文（`locale.preference: zh`，仅写桌面数据目录） |
| 插件 | `@dshd/desktop-chrome`（会话 ⋯ 菜单 / 输入框「添加」/ 斜杠命令中文）与 `dsh-better-sidebar` 仅装在桌面端，不进入 3080 |

## 卸载

- 安装版：控制面板 → 程序 → 卸载，或开始菜单 → 卸载 DeepSeek Harness Desktop。
- 绿色版：删除解压目录即可（用户数据在 `%USERPROFILE%\.dsh-desktop`，如需彻底清除可一并删除）。

## 常见问题

| 现象 | 处理 |
|---|---|
| SmartScreen「已保护你的电脑」 | 未签名应用正常提示：更多信息 → 仍要运行。正式分发请配 EV 代码签名证书 |
| 360/Defender 误报 | 未签名 Electron+Node 应用常见误报；加白名单或使用签名版 |
| 启动后白屏/闪退 | 查看 `%LOCALAPPDATA%\@dshd\desktop\logs\dsh-runtime.log`；确认不是把 macOS 包拷过来的 |
| 端口 35880 被占用 | 桌面端会自动探测空闲端口；也可设环境变量 `DSH_DESKTOP_PORT` |
