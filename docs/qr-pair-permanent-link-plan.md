# 扫码永久绑定方案（替代「每次输 PIN」）

> 版本：v1.3（不预拉历史正文；只自动跟 live 任务 + 实时工作流）
> 状态：计划（未实现）
> 时间：2026-08-19

---

## 0. 结论先行

把现在的「复制隧道 URL + 每次输 PIN」改成：

1. 桌面「设置 → 手机」出示 **二维码**（短时一次性配对票）。
2. 手机摄像头扫开后，**这一台手机被登记为已绑定设备**。
3. 以后打开 **同一个稳定域名** 的 `/phn`，**不再弹 PIN**，自动进控制台。

**「永久」在浏览器里做不到字面永久。** 本方案的永久 = 服务端设备记录不过期，直到你在桌面点「解除」；手机 cookie 最长约 180 天，每次访问自动续期。丢手机 / 卸浏览器 = 必须在桌面撤销。

**硬前提（已核实）：** 本机 named tunnel 已在跑。

| 项 | 值 |
|----|----|
| 隧道名 | `dsh-desktop`（`cloudflared tunnel --config config-dsh-desktop.yml run`） |
| 固定域名 | `https://dsh.dpharness.xyz` |
| 指到 | `127.0.0.1:35881`（PIN 门） |
| 实测 | 公网 HTTPS 200，返回 PIN 门页 |

这就是「永久绑定」要写进 QR 的 host。不要再用 trycloudflare 当永久入口。

**绑定范围：** 手机只和 **这台桌面、这个 dsh 实例** 绑定（一对多设备、一对一电脑）。没有账号、不能绑别人的 harness。设备表只活在本机 `userData/state/`。

PIN **不删**：只留给桌面本机生成新码、以及手机 cookie 丢失时的兜底。PIN 不再是日常入口。

不启用 / 不复活 `dsh-remote-web-ui`（你已要求隐藏，且它另拉一条隧道）。绑定做在现有 **PinGate + 设置→手机** 上。

---

## 1. 现状（改之前必须认清）

| 点 | 现在 |
|----|------|
| 入口 | 隧道 → `:35881` PIN 门 → 注入 companion → `/phn` 或全量 Web |
| PIN | 盐哈希落在 `userData/state/pin-hash.json` |
| 解锁后 | `dsh_pin_gate` cookie，**HttpOnly + SameSite=Strict + Secure**，TTL **7 天** |
| 会话表 | **只在内存**，桌面一重启，手机要重输 PIN |
| 未设 PIN | `verify()` 恒 false，公网进不去 |
| 权限 | `allowFullApp` 默认 true → 过门 = 整台 Agent（等于远程执行） |
| companion | 只活在门→上游的请求头里，正确，QR 里不能出现 |

所以用户痛点其实是两件事叠在一起：**(A) 每次都要 PIN**；**(B) 重启就掉登录**。只做扫码、不把设备表落盘，重启后还是要再扫。

---

## 2. 目标与非目标

### 目标

1. 桌面展示 QR；手机扫一次，该浏览器用该域名再开 `/phn` 免 PIN。
2. 桌面可看已绑定设备、可单台解除、可「解除全部」。
3. 配对票一次性、短 TTL、只能在桌面本机签发。
4. 丢手机可在桌面立刻作废该设备。
5. companion token、PIN 哈希、设备密钥 **永不进 QR、不进前端 JS、不进 git**。
6. 手机打开 `/phn` 后 **只自动跟上正在跑的任务**，实时同步工作流；不预拉历史正文（见 §3.3）。

### 非目标

- 不做账号系统、不做多用户。
- 不把 quick tunnel 的随机域名假装成永久链接。
- 不复用 1024 / web-ui 那套扫码远程。
- 不在本方案里改 `allowFullApp` 默认值（另议；见风险）。

### 红线

1. QR 里只有 **一次性 pairing ticket**，没有 PIN、没有 companion、没有设备长期密钥。
2. 签发 QR 的 HTTP 接口 **仅 127.0.0.1**（桌面设置页），公网不能领码。
3. 不确定时 **拒绝绑定，不误绑**（票过期、票已用、设备满员 → 失败页，不发 cookie）。
4. 撤销必须立刻生效（下次请求就 401/回扫码页），不能等 cookie 自然过期。

---

## 3. 推荐流程

```
桌面 设置→手机
  │  本机 POST /__pair/mint   （仅 loopback）
  │  得到 ticket（60s，单次）
  ▼
QR = https://<稳定域名>/__pair?t=<ticket>
  │  手机摄像头打开（顶级导航）
  ▼
PIN 门 GET /__pair?t=…
  │  校验 ticket：存在、未用、未过期
  │  原子：标记已用 + 生成 deviceSecret
  │  服务端只存 sha256(deviceSecret) + 设备 id + 时间
  │  Set-Cookie: dsh_device=<id.secret>  HttpOnly; Secure; SameSite=Lax; Max-Age=15552000
  │  302 → /phn   （Location 不含 t=，避免历史栏长期挂票）
  ▼
以后每次打开 https://<稳定域名>/phn
  │  带 dsh_device → 哈希比对设备表 → 通过则注入 companion，不再要 PIN
  │  每次成功访问把 cookie Max-Age 再续 180 天（滑动）
```

PIN 仍可用：cookie 无效时显示「扫码或输入 PIN」。日常路径是扫码绑定。

### 3.1 为什么是 Lax 不是现在的 Strict

摄像头 / 微信内置浏览器打开链接是 **顶级导航**。`SameSite=Strict` 在部分 WebView 里会丢掉刚种的 cookie 或回跳丢身份。配对落地用 **Lax** 更稳。companion 仍只走服务端请求头，不靠 cookie 传给 JS。

### 3.2 「永久」怎么落地

| 层 | 寿命 | 谁能杀 |
|----|------|--------|
| pairing ticket | 60 秒，用一次 | 过期自动作废 |
| 设备记录 | 无到期，直到撤销 | 桌面「解除」 |
| 浏览器 cookie | 180 天，访问则续 | 清站点数据 / 撤销后服务端不认 |

浏览器厂商在缩短长期 cookie。没有「写一次管十年」的 API。要接近永久：稳定域名 + 滑动续期 + 服务端不过期。

### 3.3 只自动跟上正在跑的任务 + 实时工作流

用户已改口：**不自动加载历史内容**；打开手机页只盯 **live 会话**，并把工作流进度实时画出来。

现状缺口：

- `/phn/api/sessions` 仍返回全部会话（实测 178 条），前端一股脑渲染。
- SSE 只转了 `agent/status`（idle ⇄ running），**没有** phase / 工具名 / 工作流日志。
- 点进一条才拉 `/surface`；live 时也不会自动进详情。

约定（可测）：

1. **默认视图 = 运行中。** `GET /phn/api/sessions?live=1`（或 host 直接过滤）只返回 `live === true`。历史入口另做「查看历史」折叠，默认关，点开才拉全量列表，且仍不预拉正文。
2. **0 条 live：** 显示「桌面当前没有正在跑的任务」+ 可选「查看历史」。
3. **1 条 live：** 打开 `/phn` 自动进该会话详情，并挂 SSE。
4. **多条 live：** 先出 live 列表（运行中置顶，按开始时间），点一条再进；不自动并行打开。
5. **实时工作流条（只推叶子字段，禁止把 Agent/Session 对象 JSON 出去）：**

| 桌面事件 | 推到手机的字段 | 界面 |
|----------|----------------|------|
| `agent/status` | `{sessionId, status}` | 顶栏：运行中 / 已停 |
| `workflow/start` | `{sessionId, runId, name}` | 新开一条工作流卡片 |
| `workflow/phase` | `{sessionId, runId, title}` | 步骤条当前步 |
| `workflow/log` | `{sessionId, runId, message}` 截断 200 字 | 滚动日志，最多留 50 行 |
| `workflow/end` | `{sessionId, runId, ok}` | 卡片标完成/失败 |
| `subagent/start` `subagent/end` | `{sessionId, label, depth}` | 子代理一行 |
| `agent/error` | `{sessionId, message}` 字符串化叶子 | 红色一条 |

6. **正文：** 进入 live 详情后拉一次 `/surface`；之后靠 SSE 增量，不轮询打满 178 路。`agent-status` 且当前就是这条时再轻量刷新 surface（已有逻辑，加上 in-flight 取消，避免返回列表后旧请求盖屏）。
7. **发送：** 仅 live 可发；结束后按钮变「无法发送」，不自动跳去历史。

不把 `session/event` 整包转发（里面是 live Session）。需要对话增量时只读 `/surface` 已裁剪的文本。

### 3.4 Quick tunnel 怎么处理

QR 里的 host 必须是 **当前公网 URL**。quick tunnel 一换，旧码、旧 cookie 域名全废。

- **要永久：只用 named tunnel 固定域名**（推荐写死在设置页：「永久绑定需要固定域名」）。
- quick tunnel：文案改成「本次隧道有效，关掉就失效」，不要写永久。

---

## 4. 数据与接口

### 4.1 落盘 `userData/state/paired-devices.json`

```json
{
  "version": 1,
  "devices": [
    {
      "id": "dev_…",
      "secretHash": "hex",
      "label": "iPhone",
      "createdAt": 0,
      "lastSeenAt": 0,
      "revokedAt": null
    }
  ]
}
```

- 原子写：写 `*.tmp` + `rename`。
- 读失败：备份 `*.corrupt-<ts>`，按空表启动（漏认不误认）。
- 上限 **5** 台；满员必须先解除。
- 密钥用 `randomBytes(32)`，只存哈希。

现有 PIN 会话表仍可作「7 天临时解锁」；设备 cookie 是另一条路径。

### 4.2 本机接口（桌面设置页，禁止公网）

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/__pair/mint` | 签发 60s 票，返回 `{ url, exp }` 给 QR |
| GET | `/__pair/devices` | 列表（无密钥） |
| POST | `/__pair/revoke` | `{ id }` 或 `{ all: true }` |

判断本机：`req.socket.remoteAddress` 是 127.0.0.1/::1。否则 404（不要 403 以免扫端口）。

### 4.3 公网接口

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/__pair?t=` | 消费票、种 cookie、302 `/phn` |
| 现有 | `/__pin` | PIN 兜底 |
| 现有 | `/phn*` | 有有效 `dsh_device` 或 PIN 会话才反代 |

`/__pair` **不**注入 companion 到查询串。302 后的 `/phn` 靠新 cookie。

### 4.4 UI

设置 → 手机 增加：

- 大号 QR（`url` 来自 mint；每 50s 自动换票，旧票作废）。
- 「复制链接」= 同一条一次性 URL（不是 PIN）。
- 已绑定列表 + 解除。
- 一句说明：永久绑定请用固定域名；当前若是 trycloudflare 则标黄。

---

## 5. 风险建议（按严重度）

### 🔴 必须当成设计约束

**R1 配对 = 把整台电脑交给那部手机**  
`allowFullApp=true` 时，绑定设备能调 Agent、改文件、跑命令。QR 被别人扫到 = 远程控制。  
对策：QR 只在桌面本机显示、60s 单次；默认绑定后 **只放行 `/phn`**（手机控制台），全量 Web 另开开关且默认关。这与「现状默认全开」冲突——本方案 **改默认：绑定设备仅 `/phn`**，桌面可勾选「允许完整 Web」（R1 修复）。

**R2 二维码是一次性机密**  
截图、投屏、相册、会议录像都能盗票。  
对策：TTL 60s + 单次；屏幕展示时桌面进程在前台；用过立刻作废；日志只记 ticket id 前 6 位。

**R3 trycloudflare 无法永久**  
域名一变 cookie 作废，用户会以为「永久坏了」去关鉴权。  
对策：产品上拆成两种模式，禁止在临时域名上写「永久」。

**R4 设备 cookie 被偷 = 长期免 PIN**  
手机中毒、共享浏览器、备份到 iCloud 未加密。  
对策：HttpOnly + Secure；可撤销；上限 5；「解除全部」一键；丢失手机的操作说明写在设置页。

**R5 URL 里的 `t=` 会进历史 / Referer / 反代日志**  
对策：消费后 **立刻 302 到不带 query 的 `/phn`**；响应 `Referrer-Policy: no-referrer`；nginx/cloudflared 不要把 query 打到 info 日志。

### 🟡 重要

**R6 现有 PIN 会话不落盘**  
只加 QR 不改存储，重启仍掉线。设备表必须落盘（§4.1）。

**R7 SameSite=Strict 会坑扫码**  
见 §3.1，配对 cookie 用 Lax。

**R8 微信 / 支付宝 WebView**  
常隔离 cookie，看起来「扫了没记住」。  
对策：落地页检测 UA，提示「用系统浏览器打开 / 添加到主屏幕」。不在微信里硬撑永久。

**R9 签发口子若暴露在公网**  
攻击者自己 mint 再扫。  
对策：mint 仅 loopback（R 红线 2）。桌面设置页走 `http://127.0.0.1:35881/__pair/mint`，不要走隧道 host。

**R10 设备满员 / 脏文件**  
满员拒绝新绑定并提示先解除。JSON 损坏则备份后空表，**不**沿用坏数据误放行。

**R11 与 companion 的关系**  
QR 成功后仍只由门注入 companion。前端永远不要读到它。

### 🟢 建议

- PIN 保留作桌面确认「我是机主」：第一次启用扫码前仍要本机已设 PIN，避免没锁的门直接发永久票。
- 绑定设备 `lastSeenAt` 供你辨认哪台是旧手机。
- 不要把设备密钥放进 localStorage（XSS 可读）。只要 HttpOnly cookie。
- Cloudflare Access / Tailscale 仍是更强一层；本方案只是「家里人扫码」，不是企业账号。

---

## 6. 对抗摘要（已并入正文）

| ID | 级 | 发现 | 处理 |
|----|----|------|------|
| R1 | 🔴 | 绑定=全盘 Agent | 绑定默认仅 `/phn` |
| R2 | 🔴 | QR 可被截图 | 60s 单次 |
| R3 | 🔴 | 临时域名无法永久 | 产品拆模式 |
| R4 | 🔴 | cookie 失窃 | 可撤销 + 上限 |
| R5 | 🔴 | ticket 进历史 | 302 去掉 query |
| R6 | 🟡 | 内存会话重启丢失 | 设备表落盘 |
| R7 | 🟡 | Strict 丢 cookie | Lax |
| R8 | 🟡 | 微信 WebView | 引导系统浏览器 |
| R9 | 🟡 | 公网 mint | 仅 loopback |
| R10 | 🟡 | 满员/坏文件 | 拒绑 / 空表 |
| R11 | 🟡 | token 进前端 | 禁止 |
| R12 | 🟢 | 与 web-ui 扫码重复 | 不复用该插件 |
| R13 | 🟢 | PIN 文案仍指向已删 FAB | 实现时改「设置→手机」 |
| R14 | 🟢 | 滑动续期要写盘 lastSeen | 节流 10min 写一次 |
| R15 | 🟢 | 时钟回拨导致票永不过期 | ticket 同时存 `expAbs`，过期用 `now>exp`，回拨超过 1h 则作废所有未用票 |
| R16 | 🟢 | 并发双扫同一票 | mint 用一次性 swap（读-改-写加锁），第二人失败页 |
| R17 | 🟡 | 打开就拉 178 条正文 | 改成只自动跟 live + SSE 工作流 |
| R18 | 🔴 | 把 Agent/Session JSON 推到手机 | 只推叶子字段，见 §3.3 表 |

第 3–5 轮未再出现新的 🔴。实现前不必再空转纸面。

---

## 7. 实现落点（若开工）

| 模块 | 文件 |
|------|------|
| 票 + 设备表 + `/__pair*` | `apps/desktop/electron/runtime/pin-gate.ts` + 单测 |
| 设置页 QR / 列表 / 撤销 | `apps/desktop/plugins/phone-settings`（本机调 35881） |
| 隧道 URL 来源 | 现有 `phone:get-status`；优先展示 named 域名 |
| 文案 | PIN 页去掉「右下角 FAB」 |

不改 `~/.dsh` 密钥文件格式以外的东西；新文件只在 `userData/state/`。

---

## 8. 验收（可测）

1. 本机 mint → QR URL 含稳定 host 与 `t=`；60s 后打开失败。
2. 同一 `t=` 第二次打开失败。
3. 成功一次后，清 PIN 会话、只留 `dsh_device`，再开 `/phn` 仍通。
4. 重启桌面进程后，同一 cookie 仍通（设备表落盘）。
5. 桌面撤销后，同一 cookie 立刻失败。
6. 从非 loopback mint → 404。
7. QR / HTML / 仓库中无 PIN、无 companion、无 device secret 明文。
8. 绑定设备默认打不开 `/api` 等全量 UI（R1）。

---

## 9. 建议

**可以按此实现，但有两个产品决定需要你点头：**

1. **永久绑定是否强制固定域名？** 推荐：是。临时隧道只发临时票。  
2. **绑定后是否仍允许完整 Web？** 推荐：默认否，只开 `/phn`。

你定这两点后就可以开工。未实现前不要把「永久链接」印在设置页上。
