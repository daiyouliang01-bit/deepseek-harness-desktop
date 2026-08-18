# Cloudflare Access 配置步骤（手机远程 DSH 安全必需）

> 公网暴露完整 DSH = 远程代码执行能力（danger-full-access）。**必须**用
> Cloudflare Access 限制为仅你的邮箱可登录，否则任何知道域名的人都能控制你的电脑。

## 前置

- Cloudflare 账号已登录（本机 cert.pem 已生成，说明已授权过 dpharness.xyz）
- 域名 `dsh.dpharness.xyz` 的 CNAME 已指向隧道 dsh-desktop

## 步骤（Zero Trust 面板）

### 1. 进入 Zero Trust
浏览器打开 https://one.dash.cloudflare.com/ → 用你的 Cloudflare 账号登录。
（首次会提示选择团队名/创建 Zero Trust 组织，免费版即可）

### 2. 创建 Access Application
左侧 **Access → Applications → Add an application**：
- 类型选 **Self-hosted**
- **Application domain**：
  - Domain: `dsh.dpharness.xyz`
  - Path: `/*`（整个站点都保护）
- 名称随意，如 `DSH Remote`

### 3. 创建 Policy（登录规则）
在应用创建流程的 Policy 部分：
- Policy name: `only-me`
- Action: **Allow**
- 规则：**Include → Emails → 输入你的邮箱**（如 `you@example.com`）
- （可选）再加 **Include → Everyone** + **Exclude → Emails → 你** 来拒绝其他人——但推荐直接用「仅你的邮箱 Allow」，其余默认 Deny

### 4. 保存
保存应用。完成后：
- 未登录访问 `https://dsh.dpharness.xyz` → 跳到 Cloudflare 登录页，邮箱验证码登录
- 登录后 → 正常进入 DSH

## 验证

- 无痕窗口访问 `https://dsh.dpharness.xyz` → 应被 Access 拦截要求登录
- 登录后 → 完整 DSH UI 可用
- 手机同样流程（首次登录一次，之后 Access 记住会话）

## 备选：局域网/内网场景
如果只在家庭/公司内网用，可以不用 Access，改用 [dsh-lan-gate](https://github.com/hchao3335-maker/dsh-lan-gate) 的内网门禁（设备批准 + 令牌）。
但**出公网（4G/5G）必须 Access 或等价认证**。
