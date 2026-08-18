# 手机远程控制桌面 DSH 完整方案（v1.0）

> 目标：手机看到的界面与桌面端**完全一致**（完整 DSH Web UI），会话/实时工作流一致，手机可控制桌面端交互。
> 前置已完成：Cloudflare 命名隧道 `dsh-desktop` + 固定域名 `dsh.dpharness.xyz` + cert.pem 登录。
> 本文按 multi-round-plan-review 技能流程评审，修订编号 R#。

## 1. 现状与根因（已实测确认）

### 1.1 用户诉求
- ❌ 不要 `/phn` 简化移动页（"和我要的不一样"）
- ✅ 手机界面 = 桌面端界面（完整 DSH Web UI）
- ✅ 会话、实时工作流与桌面端一致
- ✅ 手机能控制桌面端（发消息/操作）

### 1.2 「一直加载中」根因（已实测定位）
DSH Web 服务的 `/api/*` RPC 有 **browser-trust fence（Host 白名单，防 DNS rebinding）**：
- `Host: 127.0.0.1:3080` → ✅ 200（本机正常）
- `Host: dsh.dpharness.xyz` → ❌ 403 forbidden（隧道访问）

手机打开 `https://dsh.dpharness.xyz`：HTML/JS 能加载，但所有 API RPC（session.list、agentPreset.list、credentials.describe 等）403 → 界面拿不到数据 → 永久"加载中"。

### 1.3 官方解法（已实测验证）
`dsh --profile web --trusted-host <authority>`：放行额外 Host 进信任围栏。
实测：`--trusted-host dsh.dpharness.xyz` 后，伪造该 Host 访问 `/api/session.list` → ✅ 200；未信任 Host 仍 403（安全保留）。

## 2. GitHub 同类方案调研（成功案例）

| 方案 | 机制 | 优点 | 缺点 |
|------|------|------|------|
| [dsh-lan-gate](https://github.com/hchao3335-maker/dsh-lan-gate) | 进程内反代 0.0.0.0:3088→3080 + **Host 重写绕信任栅栏** + 设备批准/令牌/限流/手机适配 | 安全完整、手机适配好 | 面向内网，出外网需叠加隧道 |
| [dsh-lan-access](https://github.com/Leon0555/dsh-lan-access) | 改 host 0.0.0.0 + crypto.randomUUID polyfill | 最简单 | **无认证**，整网可达，仅限可信内网 |
| [DeepSeek-phone-harness](https://github.com/2903077918-lgtm/DeepSeek-phone-harness) | 独立 agent + Tailscale + token | 4G/5G 远程、有 token | 独立实现，非官方 UI |
| **本方案（选定）** | 既有隧道 + `--trusted-host` + 完整 UI | 官方机制、界面完全一致、隧道+Access 认证 | 需重启 3080 + 配置 Access |

**选型理由**：用户已有 Cloudflare 隧道 + 域名，`--trusted-host` 是 DSH 官方支持的正规解法（非 hack），完整 UI 满足"界面一致"，Cloudflare Access 提供认证（优于 lan-access 的无认证，比 lan-gate 简单——不需要设备批准逻辑）。

## 3. 方案设计

### 3.1 架构

```
📱 手机浏览器
   │ https://dsh.dpharness.xyz（完整 DSH Web UI，非 /phn）
   ▼
Cloudflare 边缘（可选 Access 邮箱登录）
   ▼
cloudflared 命名隧道 dsh-desktop
   ▼
127.0.0.1:3080（DSH Web 实例）
   │  --trusted-host dsh.dpharness.xyz（信任围栏放行）
   ▼
完整 DSH UI：会话列表 / 实时工作流(SSE) / 发消息控制 —— 与桌面端同源同数据
```

### 3.2 关键组件

| 组件 | 状态 | 动作 |
|------|------|------|
| 隧道 dsh-desktop + 域名 | ✅ 已建 | 保留 |
| `--trusted-host dsh.dpharness.xyz` | ❌ 未加 | **重启 3080 实例时加**（一次性） |
| 桌面端 spawn 加 `--trusted-host` | ❌ 未加 | harness-process 持久化（重启后仍在） |
| Cloudflare Access（域名级邮箱登录） | ❌ 未配 | 强烈建议（公网暴露=RCE 能力） |
| 隧道开机自启 | ❌ 未配 | launchd 常驻或桌面端集成 |

## 4. 评审发现（R#）

### 第 1 轮：对抗式挑刺

| 编号 | 发现 | 级别 | 处置 |
|------|------|------|------|
| R1 | **手机触屏体验**：完整 DSH UI 是桌面设计（侧边栏/悬停/拖拽），手机窄屏难操作 | 🟡 | 接受基础可用；可选注入移动 CSS（参照 lan-gate 的紧凑排版） |
| R2 | **crypto.randomUUID**：DSH UI 依赖，HTTPS 隧道下存在（安全上下文），无需 polyfill | ✅ | 验证确认即可（我们走 HTTPS） |
| R3 | **WebSocket/SSE 经隧道**：`/api/events.mux` 等 WS 升级需 cloudflared 支持（默认支持 WS） | 🟡 | 实测验证实时流 |
| R4 | **性能**：148 会话列表 + 实时流经隧道（sjc 边缘）延迟 | 🟢 | 接受；隧道延迟 ~100ms 内 |
| R5 | **安全**：公网暴露完整 DSH = 远程代码执行（danger-full-access） | 🔴 | **必须 Cloudflare Access**，否则任何人可控制电脑 |
| R6 | **持久化**：隧道进程手动起的，重启后消失 | 🟡 | launchd 常驻（后续） |
| R7 | **重启 3080 会中断当前会话**：加 trusted-host 需重启 | 🟡 | 选低峰时段；会话数据持久化不受影响 |

### 第 2 轮：整篇重推演（结构检查）

- **语义一致性**：用户要"界面一致" → 直接访问根路径（完整 UI），**不用 /phn**。✓ 已明确
- **数据一致性**：手机和桌面连同一 3080 → 会话/实时天然一致 ✓
- **双向控制**：完整 UI 自带发消息/新建会话/操作 → 手机可控制 ✓
- **路径完整性**：隧道 → trusted-host → 完整 UI → WS 实时，每条链路都有出口 ✓
- **平台**：`--trusted-host` 跨平台（dsh 内置）✓

### 第 3 轮：多维度扫描

| 维度 | 状态 | 说明 |
|------|------|------|
| 安全 | 🔴 FAIL → R5 | 公网完整 UI 必须 Access |
| 性能 | ✅ | 隧道延迟可接受 |
| 可靠性 | 🟡 | 隧道进程依赖手动启动（R6） |
| 移动体验 | 🟡 | 桌面 UI 在手机上的可用性（R1） |
| 数据一致性 | ✅ | 同实例同数据 |
| 边界 | ✅ | trusted-host 保留未信任 Host 403 |

### 第 4 轮：压力测试

| 场景 | 结果 |
|------|------|
| 手机 4G 访问（非同一 WiFi） | ✅ 隧道出站，任何网络可达 |
| 未信任 Host 攻击（DNS rebinding） | ✅ 仍 403（trusted-host 白名单） |
| 隧道进程死（电脑重启） | 🟡 需要 launchd 自启（R6） |
| 多设备同时访问 | ✅ 无连接数限制；Access 可限流 |
| 会话损坏/大会话 | ✅ 同 3080 现有能力 |

## 5. 验收清单

- [ ] 手机打开 `https://dsh.dpharness.xyz` 显示**完整 DSH 界面**（与桌面一致）
- [ ] 会话列表加载（同 3080 的 148 会话）
- [ ] 点开会话看历史（与桌面一致）
- [ ] 桌面端 agent 运行时，手机实时看到状态变化（SSE/WS）
- [ ] 手机发消息 → 桌面端 agent 响应（双向控制）
- [ ] 未信任 Host 仍 403（安全防护保留）
- [ ] Cloudflare Access 配置后，未登录用户被拦

## 6. 实施步骤

1. **重启 3080 实例**加 `--trusted-host dsh.dpharness.xyz`（一次性，选低峰）
2. **桌面端持久化**：harness-process.ts spawn 参数加 `--trusted-host`（从配置读，可多个）
3. **验证手机完整 UI**：puppeteer 手机视口截图 + 功能走查
4. **配 Cloudflare Access**（域名级邮箱登录，R5 安全必需）
5. **隧道常驻**：launchd plist（R6）

## 7. 已知残余风险

- R1（手机触屏体验）：完整 UI 非移动优先，重度使用需滚动/缩放；如需可后续注入移动 CSS
- 重启 3080 的短暂中断（几秒，会话数据不丢）
