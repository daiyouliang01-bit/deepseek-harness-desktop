# Runtime Lifecycle — dsh 进程生命周期设计

> Task 7.1 deliverable。记录桌面应用对 `dsh` 子进程的生命周期管理设计：单实例保障、进程台账、孤儿回收、实例复用、崩溃自愈。实现见 `apps/desktop/electron/runtime/`，评审过程见 `runtime-lifecycle-hardening-plan.md`（v1.4）。

## 1. 目标

对 dsh 进程做到 **「一个、归我管、随我死」**：

- **单实例**：任意时刻最多 1 个由本应用 spawn 的 dsh 在写 `~/.dsh`；
- **可回收**：崩溃 / 强退 / 断电后重启不留孤儿；
- **不误杀**：只回收台账三重校验匹配的进程，绝不误杀手动 `dsh web` 或 PID 被复用的无关进程；
- **可感知**：检测到手动实例并存时警告并给出处置选项（含隔离模式）。

**为什么必须单实例**：DSH 的会话日志（`session.jsonl.zstd`）是追加式文件，无跨进程锁。两个 dsh 实例同时写同一份日志会因 seq 计数器不一致产生 seq 回退，日志损坏，会话历史不可读（2026-08-16 真实事故）。

## 2. 进程台账（Process Ledger）

**位置**：`<userData>/state/process-ledger.json`

> 注意：这是**进程台账**，与 `runtime-manifest.json`（Task 2.3 的 dsh 版本升级台账，位于 `config/`）是两份不同的文件。

```jsonc
{
  "version": 2,
  "spawned": {
    "pid": 50232,
    "startedAt": 1786800000000,   // spawn 前一刻的 epoch ms
    "port": 35880,                // 固定端口；随机端口为 null
    "readyUrl": "http://127.0.0.1:35880",
    "dshVersion": "0.1.0-rc.6",   // spawn 时捕获
    "adopted": false              // true = 复用/接管的外部实例（校验放宽）
  },
  "lastExit": { "kind": "clean" | "crash" | "unknown", "at": 1786800200000 }
}
```

写入规则：

- **原子写**：`process-ledger.json.tmp` → `fs.rename()` 覆盖（`process-ledger.ts: saveLedger`）。
- **读失败容错**：损坏 / 缺失 / 版本不符 → 备份为 `.corrupt-<ts>` 后按空台账冷启动，绝不阻塞启动。
- **退出标记同步写**：`before-quit` / `will-quit` 用同步写记录 `lastExit.kind = "clean"` 并清空 `spawned`（异步写可能未落盘进程已退）。

## 3. 孤儿判定：三重校验

**禁止仅凭 pid 存活判定**——PID 会被 OS 复用。判定「pid 就是我上次 spawn 的 dsh」需全部满足：

1. **存活**：`ps` 能查到该 pid（快速初筛）；
2. **启动时刻匹配**：`ps -o etime=`（运行时长，与 locale 无关）换算的启动时刻 ≈ 台账 `startedAt`（±5s）。
   > 实测教训：`ps -o lstart=` 输出是本地化的（中文环境输出「一 8月/17 00:39:31 2026」），`Date.parse` 返回 NaN。**必须用 etime**。
3. **命令行签名**：`ps -o command=` 含 `desktop-tools.patch.yml`（应用签名）。
   > 实测教训：macOS 的 ps command 列会截断长 argv——用**关键子串匹配**而非整串比对。

任一不符 → 只清台账，**不杀进程**（PID 复用 / 手动实例 / 僵尸都落在安全方向）。

僵尸进程（state `Z`）视为已死——`kill -0` 对僵尸恒真、信号是 no-op，不能作为存活依据。

## 4. 进程组与击杀

- POSIX：`spawn(..., { detached: true })` 让 dsh 自成进程组，`process.kill(-pgid, 'SIGTERM')` 才能杀整棵树。
  > 实测教训：`detached: false` 时 `kill(-pid)` 抛 ESRCH 回退为只杀直接子进程，孙进程（shell/工具）漏网。
- 击杀序列：SIGTERM → 轮询（≤2s，state Z 视为死）→ SIGKILL → 确认死透（`orphan-reaper.ts: killProcessGroup`）。
- Windows：`taskkill /pid <pid> /T /F`。

## 5. 启动流程

```
app 启动
 ├─ (A) 读台账（损坏 → 空台账）
 ├─ (B) 台账实例处置（探活优先）：
 │      台账有 spawned 且 readyUrl 实时探测健康（含 __DSH_BOOT__ 验证）→ 复用，跳 (F)
 │      否则 pid 存活 → 三重校验 → 匹配则 SIGTERM→SIGKILL→确认死透；不匹配只清台账
 ├─ (C) 共存检测（只报告不杀）：非台账的 dsh 实例
 │      含应用签名 → 应用遗留孤儿 → 询问回收
 │      无签名 → 手动实例 → 警告（三选一：退出/忽略/隔离模式）
 ├─ (D) 复用判定：固定端口（默认 35880）被健康 dsh 占用 → 复用并接管
 ├─ (E) spawn 新实例：固定端口空闲→用它；被占非 dsh→findFreePort 回退；耗尽→--port 0
 └─ (F) 健康探测 → 更新台账 → UI 加载
```

## 6. 实例复用

- **台账复用**：`readyUrl` 实时探测，响应须含 `__DSH_BOOT__`（R8，避免复用假服务）。
- **端口复用**：固定端口被占 → `__DSH_BOOT__` + argv 校验 + dshVersion 比对 → 通过则 `adopt()` 接管。
- **接管实例**：写入台账并标记 `adopted: true`，校验放宽为「pid + etime」两重（其命令行无 patch 参数）。

## 7. 崩溃自愈与自动重启

- `SIGTERM` / `SIGINT` / `will-quit` 全路径兜底调用 `stop()`（不依赖 `before-quit`）。
- **意外退出自动重启**：`handleExit` 判定非预期退出（非用户 stop、非 code 0/SIGTERM/SIGKILL）→ 指数退避重启 1s→2s→4s→…上限 30s。
- **重试上限**：连续快速崩溃（30s 窗口内）超 5 次 → 停止重启、置 error、UI 显示手动重试。
- 用户手动 `stop()` 先 disarm，绝不触发重启。
- 重启成功后更新台账（新 pid），否则下次启动会被共存检测误报。

## 8. 端口策略

- 首选固定端口 **35880**（应用专属，避开 3080 默认端口），可用 `DSH_DESKTOP_PORT` 环境变量覆盖。
- 冲突时：健康 dsh 占用 → 复用；否则随机端口兜底；`--port 0` 为最终保底。
- **不用 3080**：那是手动 `dsh web` 的默认端口。

## 9. 共存检测与隔离模式

- `detectCoexistingInstances()`：**只报告，不杀**（击杀仅限台账内 pid）。
- 按应用签名分类：`app-orphan`（应用遗留，询问回收）vs `manual`（手动实例，警告）。
- **隔离是默认**：桌面端默认 `DSH_HOME=~/.dsh-desktop`，与手动 `dsh web`（`~/.dsh` / :3080）物理隔离。启动时会把指向 `~/.dsh` 的泄漏 symlink 拷一份再断开。会话数据与 3080 不互通（有意取舍）。禁止把桌面数据目录设回 `~/.dsh`。

## 10. 平台差异（R18）

| 能力 | POSIX (macOS/Linux) | Windows |
|------|---------------------|---------|
| 三重校验 | `ps -p <pid> -o etime=,state=,pgid=,command=` | `Get-CimInstance Win32_Process`（CreationDate/CommandLine） |
| 存活探测 | `ps` 查询 | `Get-Process -Id` |
| 进程组击杀 | `detached: true` + `kill(-pgid)` | `taskkill /T /F` |
| 共存检测 | `ps aux` | `Get-CimInstance` 过滤 |

## 11. 已知限制（R10）

- **dev（`electron-vite dev`）与打包版 userData 不同**，台账互不可见——二者**不可同时运行**，否则各自 spawn 的 dsh 会互相视为外部实例并警告。如需共跑，用隔离模式。
- `ps` 输出解析为防御式：任何解析失败按「不匹配」处理（漏杀不误杀）。
- 系统时钟调整（NTP 回拨）→ etime 换算失配 → 漏杀不误杀（接受）。
- 进程组逃逸（孙进程 setsid）的进程不写会话日志，低风险，不追。

## 12. 代码地图

| 模块 | 职责 |
|------|------|
| `runtime/process-ledger.ts` | 台账读写（原子写 / 损坏容错） |
| `runtime/orphan-reaper.ts` | 三重校验 / 进程组击杀 / 等待死透 |
| `runtime/coexistence.ts` | 共存检测（签名分类，只报告） |
| `runtime/ledger-integration.ts` | 台账集成：记录生命周期、reap 前置、tryReuse |
| `runtime/harness-process.ts` | dsh 进程管理：spawn / adopt / stop / 自动重启 |
| `main/index.ts` | 启动流程编排：reap → 共存 → reuse → spawn |
