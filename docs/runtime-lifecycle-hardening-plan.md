# dsh 进程生命周期加固计划 v1.4

> 状态：四轮评审 + 实测验证完成（v1.4 并入 R26-R27：真实进程测试发现的 locale 与 ps 截断问题）
> 起因：2026-08-16 会话 `session-164e73e9` 日志损坏（seq 回退 2062），根因是 5 个残留 dsh 进程并发写同一份会话日志。DSH 会话日志无跨进程锁，**唯一可靠的防护是保证同一时刻只有一个 dsh 实例在写同一份数据**。
> 范围：`apps/desktop/electron/`（进程生命周期）+ `scripts/`（应急工具）+ `docs/`（设计文档）。不改 dsh 上游。

---

## 1. 目标与成功标准

### 1.1 目标

对 dsh 进程做到 **「一个、归我管、随我死」**：

- **单实例**：任意时刻，本机最多只有 1 个由本应用 spawn 的 dsh 实例在写 `~/.dsh`；
- **可回收**：崩溃 / 强退 / 断电后重启，不留孤儿、不自相打架；
- **不误杀**：只回收「台账确认为本应用 spawn 且身份三重匹配」的进程，绝不误杀用户手动跑的 `dsh web` 或其他无关进程；
- **可感知**：检测到「应用实例 + 手动实例共存」这一高风险局面时，明确警告并给出处置选项（含隔离模式）。

### 1.2 成功标准（可验证）

| # | 标准 | 验证方式 |
|---|------|---------|
| S1 | 连续 10 次「启动 → SIGKILL 主进程 → 重启」循环后，应用 spawn 的 dsh 数量 ≤ 1（健康实例被复用而非累积） | 手动验收脚本（集成测试用 fixture 进程，见 R12） |
| S2 | 应用重启时若检测到**自己上次遗留的健康 dsh**，直接复用，不重复 spawn | 集成测试 |
| S3 | 用户手动 `dsh web` 不被杀；共存时应用弹出明确警告 | 集成测试 + 手动验收 |
| S4 | PID 被 OS 复用给无关进程时，**不误杀**（台账三重校验不匹配 → 只清台账） | 单测（伪造 pid 复用场景） |
| S5 | 全部既有测试通过（`pnpm test`），新增用例覆盖上述场景 | CI |

---

## 2. 现状审计

### 2.1 已有能力（保留复用）

| 能力 | 位置 |
|------|------|
| `requestSingleInstanceLock()` | main/index.ts:137 |
| `before-quit` → `runtime.stop()` | main/index.ts:534-537 |
| `HarnessProcess.killTree()`（POSIX 组杀 / Windows taskkill） | harness-process.ts:233 |
| `port-probe.ts`（`isPortFree` / `findFreePort`） | runtime/port-probe.ts |
| 测试基建（FakeChild + mock spawn；真实 dsh 集成测试） | harness-process.test.ts / .integration.test.ts |

### 2.2 缺口

| 编号 | 缺口 | 后果 |
|------|------|------|
| G1 | 强退 / 崩溃 / 断电不触发 `before-quit`，子进程不被回收 | 50232/51918 即强退遗留的孤儿 |
| G2 | 启动前不清理上次遗留 | 孤儿累积，全部共享 `~/.dsh` |
| G3 | 手动 `dsh web` 不受 Electron 单实例锁约束 | 手动实例与应用实例并存 → 损坏风险 |
| G4 | 无崩溃自愈：无法区分「正常停止」与「崩溃遗留」 | 下次启动不感知、不处置 |
| G5 | **无共存检测**：即使回收干净，手动实例并存时风险依旧 | 损坏可随时重演 |
| G6 | **killTree 进程组 bug**：`spawn` 未 `detached: true`，`kill(-pid)` 抛 ESRCH 后回退只杀直接子进程 | dsh 的孙进程（shell/工具）漏网 |

---

## 3. 方案设计

### 3.1 进程台账 `runtime-manifest.json`（v2）

位置：`userData/state/runtime-manifest.json`（注意 dev 与打包版 userData 不同，见 R10）。

```jsonc
{
  "version": 2,
  "spawned": {
    "pid": 50232,
    "startedAt": 1786800000000,      // spawn 时刻（ms），供三重校验比对 lstart
    "port": 35880,                    // 固定端口；随机端口时为 null
    "readyUrl": "http://127.0.0.1:35880",
    "dshVersion": "0.1.0-rc.6"        // R13：spawn 时记录 `dsh --version`，供复用校验
  },
  "lastExit": {
    "kind": "clean" | "crash" | "unknown",
    "at": 1786800200000
  }
}
```

写入规则：

- **原子写（R6）**：写 `runtime-manifest.json.tmp` → `fs.rename()` 覆盖。读失败（损坏/缺失）按「无台账」冷启动，不阻塞。
- **退出标记同步写（R7）**：`before-quit` / `will-quit` 中用 `writeFileSync` 写 `lastExit.kind = "clean"` 并清空 `spawned`；异步写可能未落盘进程已退。
- spawn 成功 → 写 `spawned`；健康探测通过 → 更新 `readyUrl`（限状态迁移时写，避免每探一写）。
- 已删除 v1.0 的 `appInstanceId` 字段（无实际用途，R13）。

### 3.2 孤儿判定：三重校验（R1 + R26/R27 实测修正）

**禁止仅凭 `pid` 存活判定**——PID 会被 OS 复用，会误杀无关进程。

```ts
// 判定「pid 就是我上次 spawn 的 dsh」需全部满足：
// ① kill(pid, 0) 存活（仅作快速初筛）
// ② 启动时刻匹配：`ps -o etime=` 换算启动时刻 == manifest.spawned.startedAt（容差 ±5s）
//    实测修正（R26）：不使用 `ps -o lstart=` + Date.parse —— lstart 输出是本地化的
//    （中文环境输出「一 8月/17 00:39:31 2026」，Date.parse 返回 NaN），etime 与 locale 无关
// ③ 命令行签名匹配：`ps -o command=` 含 dsh 且含 `desktop-tools.patch.yml`
//    实测修正（R27）：macOS 的 command 列会截断长 argv，用「关键子串匹配」
//    （desktop-tools.patch.yml / --profile / web）而非完整 argv 比对
// 任一不符 → 视为台账过期：只清台账，不杀进程（满足 S4）
```

对**单个已知 pid** 做 `ps -p` 检查不属于全盘扫描，不违反「不误杀手动实例」红线。

### 3.3 进程组与击杀（R3，修复 G6）

- **POSIX**：`spawn(dshBin, args, { detached: true, stdio: [...] })` —— 子进程自成进程组，`process.kill(-pid, 'SIGTERM')` 才真正生效（杀整棵树）。
- **Windows**：维持 `taskkill /pid <pid> /T /F`。
- **孤儿回收按进程组**：`ps -o pgid=` 取台账 pid 的组 → 杀整组（回收对象本身可能已脱离原父进程，但进程组仍可寻址）。

### 3.4 启动流程（完整版，v1.2 修正）

> v1.2 核心修正（R14）：**「探活 → 复用 or 回收」合并为同一决策点**。v1.1 中 B 步（回收）与 D 步（复用）自相矛盾——先杀台账实例再探测复用，复用路径必然失败。正确逻辑：健康优先复用，只有探活失败才回收。

```
app 启动
 ├─ (A) 读取 runtime-manifest（损坏 → 空台账，继续）
 ├─ (B) 台账实例处置（探活优先，R14）
 │      ├─ 台账有 spawned 且 readyUrl 实时探测健康（含 __DSH_BOOT__ 验证，R15）→ 复用，跳 (F)
 │      ├─ 否则 pid 存活 → 三重校验（3.2）
 │      │    ├─ 匹配 → SIGTERM → 轮询等退出(≤2s) → SIGKILL → 确认死透（R4）
 │      │    └─ 不匹配 → 只清台账（S4）
 │      └─ 无记录 / pid 已死 → 继续
 ├─ (C) 共存检测 detectCoexistingInstances()（R2，只报告不杀）
 │      ├─ 隔离模式已激活 → 降级为静默提示（物理隔离无害）
 │      └─ 否则存在非台账 dsh → 模态警告三选一：
 │           ① 退出应用（推荐）
 │           ② 忽略继续（提示日志损坏风险）
 │           ③ 以隔离 DSH_HOME 模式启动（3.7）
 ├─ (D) 固定端口策略（3.5）
 │      ├─ 端口空闲 → spawn（--port 35880），写台账
 │      ├─ 端口被健康 dsh 占用（__DSH_BOOT__ + argv + dshVersion 验证通过，R8）→ 复用并接管台账
 │      └─ 端口占用但非健康 dsh → findFreePort() 随机端口兜底，写台账
 ├─ (E) 意外退出自动重启（R9/R16）：handleExit 非预期 → 指数退避重启 → **更新台账 spawned（新 pid）**
 └─ (F) 健康探测 → 更新台账 → UI 加载
```

### 3.5 端口策略

- **首选固定端口 35880**（应用专属，避开 3080 默认端口与常见端口）。
- 冲突时（R8 身份验证）：端口被健康 dsh 占用 → 复用；否则 `findFreePort()` 随机兜底（保持现行为）。
- 端口做成配置项（`config.json` → `runtime.port`，默认 35880）。
- 不用 3080：那是手动 `dsh web` 的默认端口，占用会造成 G3 冲突。

### 3.6 实例复用（S2，v1.2 修正）

**所有复用路径必须先通过 `__DSH_BOOT__` 身份验证（R15）**——v1.1 仅端口占用路径做了验证，台账复用路径缺失，会导致复用假服务。

1. **台账复用**：`spawned.readyUrl` 实时探测（GET），**响应须含 `__DSH_BOOT__`** → 复用，跳过 spawn（R5 实时探测，不用时间窗）。
2. **端口复用**：固定端口被占 → 探测 `/` 含 `__DSH_BOOT__` + `ps -p <pid> -o command=` 校验 patch/profile 与预期一致（R8）→ 通过则复用并**接管**；不通过则杀（仅台账内 pid）重起。
3. **接管实例的台账归属（R17）**：被接管的非台账实例（如手动 `dsh web` 恰好占 35880）写入台账并标记 `adopted: true`；其命令行无 patch 参数，**校验放宽为「pid + lstart」两重**——否则下次启动会被当成外部实例误报。
4. **版本校验**：复用实例 `dshVersion` 与预期不符（R13）→ 杀重起。

### 3.7 共存检测与隔离模式（R2）

- `detectCoexistingInstances()`：**只报告，不杀**。ps 检测命令行含 `dsh` + `web`/`--profile web`、且不在台账管理范围内的进程。
- 检测到 → 模态警告，三选一：退出应用 / 忽略（标注风险）/ **隔离 DSH_HOME 模式**。
- 隔离模式：应用以独立 `DSH_HOME`（如 `userData/dsh-home`）spawn dsh，与手动实例**物理隔离**，从根上杜绝共享日志。会话数据与手动实例不互通（文档中说明取舍）。

### 3.8 崩溃自愈与自动重启

**自愈（G4）**
- `process.on('SIGTERM'/'SIGINT')` + `app.on('will-quit')` 全路径兜底调用 `stop()`（保留现有 `before-quit`）。
- 启动早期（窗口创建前）执行 reapAll —— 同时完成 G1/G2/G4。

**意外退出自动重启（R9/R16，升为正式功能）**
- `handleExit` 判定非预期退出（非用户 stop、非 code 0/SIGTERM/SIGKILL）→ 指数退避重启：1s → 2s → 4s → … 上限 30s，UI 显示重连状态。
- 用户手动 stop 不触发。
- 与孤儿回收不冲突：重启前先确认旧进程确实死亡（R4 的等待逻辑）。
- **重启成功后必须更新台账 spawned（新 pid）（R16）**：否则下次启动三重校验不匹配 → 新实例被共存检测误报为手动实例。

---

### 3.9 平台覆盖（R18）

| 能力 | POSIX (macOS/Linux) | Windows |
|------|---------------------|---------|
| 三重校验 | `ps -p <pid> -o lstart=` / `-o command=` | `Get-CimInstance Win32_Process`（CreationDate / CommandLine） |
| 孤儿存活探测 | `kill(pid, 0)` | `Get-Process -Id` |
| 进程组击杀 | `detached: true` + `kill(-pgid)` | `taskkill /pid <pid> /T /F`（已存在） |
| 共存检测 | `ps aux` 过滤 | `Get-CimInstance Win32_Process` 过滤 |

**细节约定**：`startedAt` 在 `spawn()` 调用**前**记录；与 `lstart` 比对容差 **±2s**（覆盖 spawn→exec 延迟）。

### 3.10 压力测试加固（R19-R25，第三轮评审）

> 对抗场景推演发现 5 个 FAIL、3 个 PARTIAL，修复如下。场景明细见文末附表。

**R19 共存检测按应用签名分类（迁移场景关键）**
升级后首次启动时，历史孤儿（如 2026-08-16 的 5 个）不在任何台账里——共存检测必须能识别它们，否则会被误报为「手动实例」。
- 候选进程按 argv 分类：
  - 含 `desktop-tools.patch.yml`（dev 与打包版同名 basename）→ **应用签名孤儿** → 弹窗询问「检测到上次应用遗留的 dsh（pid/启动时间），是否回收？」→ 用户确认后杀
  - 不含 → **手动实例** → 原有三选一警告
- 手动实例恰好带 patch 参数（用户复制应用命令）→ 误分类为应用孤儿，误伤概率低，接受（记录在案）

**R20 僵尸进程处理**
`kill -0` 对僵尸进程永远返回成功，SIGTERM/SIGKILL 均为 no-op，「确认死透」轮询会无限等待。
- 存活判定与死透确认改用 `ps -p <pid> -o state=`：状态 `Z`（zombie）→ 视为已死（init 会回收）
- `kill -0` 仅作快速初筛，不作死透依据

**R21 复用探测超时放宽，避免误杀启动中的健康 dsh**
dsh 首次启动（加载插件/初始化）可能需 10-30s，2s 探测超时会把「启动中」误判为「不健康」→ 三重校验匹配 → 误杀。
- 复用探测超时放宽至 **5-10s**
- 追加判定：三重校验匹配但 `ps state` 为启动早期（可结合 dsh 日志输出）→ 视为「可能健康」，等待而非击杀
- 击杀前最后一步重验 lstart（见 R23）

**R22 自动重启重试上限**
指数退避上限 30s 但无重试上限 → 配置错误导致 dsh 秒退时**永远循环**。
- 连续 5 次「启动后 30s 内退出」→ 停止自动重启，UI 显示错误 + 手动重试按钮
- `stopping`/`stopped` 状态下定时器不触发（防退出竞态）

**R23 kill(-pgid) TOCTOU 防护**
三重校验与击杀之间存在 PID 复用窗口。
- 击杀前立即重验 lstart（二次确认）
- Linux：优先 `pidfd_open` + `pidfd_send_signal`（内核级防复用）
- macOS：无 pidfd，接受残余风险并记录（窗口极小：校验→击杀间隔毫秒级）

**R24 端口兜底链完整化**
`findFreePort` 返回 null（端口全占）时：
- 最终兜底 **`--port 0`**（OS 分配），台账 `port` 记为 null、以 readyUrl 为准
- 台账复用路径不受影响（R15 实时探测）

**R25 退出标记与台账写入的异常安全**
- `before-quit`/`will-quit` 的同步写用 **try/catch 包裹**，任何写失败不得阻塞退出（退出优先）
- 台账读取失败时：**先备份损坏文件**（`runtime-manifest.json.corrupt-<ts>`）再按空台账处理，便于事后排查
- 原子写遗留的 `.tmp` 文件在下次启动时清理

**平台与边界备注**
- `ps -o lstart=` 输出解析做防御式处理（不同平台/语言环境格式差异，解析失败按不匹配→漏杀处理，fail-safe）
- 系统时钟调整（NTP 回拨）→ lstart 与 startedAt 失配 → 漏杀不误杀（fail-safe 方向，接受）
- 进程组逃逸（孙进程 setsid）的进程不写会话日志，低风险，不追

---

## 4. 实施步骤

### Phase 1：台账 + 三重校验回收 + 共存检测 + killTree 修复（核心）

- [x] 1.1 新增 `runtime/runtime-manifest.ts`：v2 台账读写（原子写 R6、同步退出标记 R7、dshVersion R13、损坏容错）
- [x] 1.2 新增 `runtime/orphan-reaper.ts`：`findOrphans`（三重校验 R1）/ `reapAll`（进程组击杀 R3 + 等待死透 R4）/ `markExit`
- [x] 1.3 修复 `harness-process.ts`：`spawn` 加 `detached: true`（R3）；`start()` 前调用 `reapAll()`；spawn 成功写台账；健康通过更新台账；`stop()` 写 clean 标记
- [x] 1.4 新增 `runtime/coexistence.ts`：`detectCoexistingInstances()`（R2，只报告）
- [x] 1.5 `main/index.ts`：启动早期执行 reapAll + 共存检测（模态三选一，含隔离 DSH_HOME 模式入口）；`will-quit` 兜底；`SIGTERM/SIGINT` 处理
- [x] 1.6 测试：
  - `runtime-manifest.test.ts`：读写、原子性（tmp+rename）、损坏容错、版本
  - `orphan-reaper.test.ts`：三重校验匹配/不匹配（含 **PID 复用误杀场景 S4**）、等待退出时序（R4）
  - `coexistence.test.ts`：检测逻辑（mock ps 输出）
  - `harness-process.test.ts` 扩展：detached 参数断言（R3）
  - `orphan-reaper.integration.test.ts`：fixture 子进程模拟孤儿（R12）

### Phase 2：固定端口 + 实例复用

- [x] 2.1 端口配置项（`config.json` → `runtime.port`，默认 35880）
- [x] 2.2 `HarnessProcess` 固定端口 spawn + `isPortFree`/`findFreePort` 回退
- [x] 2.3 `tryReuse()`：台账实时探测复用（R5）+ 端口占用身份验证复用（R8：`__DSH_BOOT__` + argv 校验 + dshVersion）
- [x] 2.4 测试：`port-probe.test.ts` 扩展；集成测试「先手动起 dsh 在 35880 → 启动应用 → 断言复用不 spawn」；「端口被非 dsh 服务占用 → 随机端口兜底」

### Phase 3：崩溃自愈 + 自动重启

- [x] 3.1 SIGTERM/SIGINT/will-quit 全路径 stop
- [x] 3.2 `markExit('crash')` 检测与自愈日志
- [x] 3.3 意外退出自动重启（R9）：`handleExit` + 指数退避 + UI 重连状态
- [x] 3.4 测试：fixture 子进程模拟「dsh 意外死亡」→ 断言自动重启与退避；「用户手动 stop 不触发重启」

### Phase 4：文档与应急工具

- [x] 4.1 `docs/runtime-lifecycle.md`：台账设计、端口策略、单实例保障原理（ADR 风格）；**dev 与打包版不可同时运行的限制（R10）**
- [x] 4.2 沉淀 `scripts/repair-session-log.mjs`（源自今日修复）：`--dry-run` / `--backup` / 修复后自校验；**前置守卫：检测到任何 dsh 进程在跑即拒绝执行（R11）**
- [x] 4.3 `docs/troubleshooting.md` 新增「会话历史无法打开 → 日志损坏 → 修复步骤」
- [x] 4.4 更新 `docs/data-locations.md`（runtime-manifest.json 位置与隔离 DSH_HOME 说明）

---

## 5. 风险与对策

| 风险 | 对策 |
|------|------|
| PID 复用导致误杀 | 三重校验（R1）：pid + lstart + 命令行，任一不符只清台账 |
| 手动实例并存 | 共存检测 + 模态警告 + 隔离 DSH_HOME 模式（R2） |
| 回收与 spawn 端口竞态 | reapAll 等待旧进程死透后才继续（R4） |
| 固定端口被其他软件占用 | 身份验证（`__DSH_BOOT__`）→ 复用 or 随机端口兜底（R8） |
| manifest 损坏 | 原子写 + 读失败按空台账冷启动（R6） |
| 退出标记丢失 | 同步写（R7） |
| 复用实例配置/版本不符 | argv 校验 + dshVersion 校验 → 杀（台账内）重起（R8/R13） |
| dev 与打包版并存 | 文档明令禁止（R10）；如需共跑，用隔离 DSH_HOME |
| dsh 意外崩溃导致 UI 瘫痪 | 自动重启 + 指数退避 + 重连状态（R9） |
| 修复工具运行中被 dsh 写坏 | 前置守卫拒绝执行（R11） |

---

## 6. 明确不做的事

- ❌ 不改 dsh 上游源码（会话日志加锁可作 upstream issue 建议，不阻塞本计划）
- ❌ 不用 `ps` 全盘扫描做通用清理（误伤面太大；只对台账内单个 pid 做 `ps -p` 校验）
- ❌ 不用 3080 端口（手动 `dsh web` 默认端口，会冲突）
- ❌ 不做多实例「并发安全」改造（DSH 设计前提是单实例；桌面端只需保证单实例）
- ❌ 隔离 DSH_HOME 不做默认（默认仍共享 `~/.dsh`，隔离是用户可选项）

---

## 7. 验收清单

### 自动化（CI）
- [x] `pnpm test` 全绿（191 通过 / 8 跳过：台账、回收、三重校验、共存检测、端口、复用、自动重启）

### 手动（打包版）— 待打包后逐项验收
- [ ] 正常启动/退出：`ps aux | grep dsh` 无残留
- [ ] 托盘退出：无残留
- [ ] `kill -9 <electron主进程>` 后重启：旧 dsh **被复用或回收**，应用 spawn 的 dsh 数量 ≤ 1（S1）
- [ ] **连续 10 次强退循环（S1）**：应用 spawn 的 dsh 数量 ≤ 1（每次重启后健康实例被复用，数量不增）
- [ ] 手动 `dsh web` 跑在 35880：应用启动弹出共存警告；选「忽略」→ 应用复用该实例（不重复 spawn）
- [ ] 手动 `dsh web` 跑在 3080：应用不受影响，走随机端口
- [ ] 手动 `dsh web` 跑在 35880：选「隔离模式」→ 应用用独立 DSH_HOME，两者互不干扰
- [ ] 伪造 PID 复用：台账 pid 被无关进程占用 → 应用只清台账不杀进程（S4）
- [ ] **升级后首次启动（含历史孤儿，R19）**：5 个旧孤儿被识别为「应用遗留」并询问回收，不被误报为手动实例
- [ ] 僵尸进程场景（R20）：fixture 制造僵尸 → 回收不卡死
- [ ] dsh 秒退崩溃循环（R22）：连续 5 次后停止重启并显示错误
- [ ] **中文 locale 环境（R26）**：`LANG=zh_CN.UTF-8` 下三重校验正常工作（etime 法）
- [ ] **macOS argv 截断（R27）**：长命令行下应用签名仍能匹配（关键子串法）

---

*修订记录：v1.0（初稿）→ v1.1（R1-R13）→ v1.2（R14-R18）→ v1.3（R19-R25）→ v1.4（R26-R27：实测验证——中文 locale 下 lstart 解析失败改用 etime；macOS ps command 截断改用关键子串匹配；实测 8/8 场景通过，含真实 dsh 进程的迁移场景、三重校验、进程组击杀、手动实例分类）。*

---

## 附录：第三轮压力测试场景表

| # | 对抗场景 | 结果 | 处置 |
|---|---------|------|------|
| 1 | 升级后首启：历史孤儿不在台账 | FAIL | R19 应用签名分类 |
| 2 | 僵尸进程：kill -0 恒真、信号 no-op | FAIL | R20 ps state 判定 |
| 3 | 崩溃时 dsh 仍在首次启动中 → 2s 探测失败误杀 | FAIL | R21 超时放宽 + 状态判定 |
| 4 | dsh 秒退崩溃循环 → 无限重启 | FAIL | R22 重试上限 |
| 5 | kill(-pgid) TOCTOU：校验后 PID 被复用 | PARTIAL | R23 杀前重验 / pidfd |
| 6 | 断电/时钟回拨：lstart 失配 | PASS | 漏杀不误杀（fail-safe） |
| 7 | 手动实例恰好带 patch 参数 | PARTIAL | 误分类概率低，接受 |
| 8 | 端口全占：findFreePort 返回 null | FAIL | R24 兜底 --port 0 |
| 9 | before-quit 磁盘满：同步写抛异常阻塞退出 | FAIL | R25 try/catch |
| 10 | dev + 打包版同跑 | PARTIAL | R10 文档限制 + R19 互相报警 |
| 11 | 进程组逃逸（setsid） | PASS | 逃逸进程不写会话日志，低风险 |
| 12 | 接管的手动实例被用户关闭 | PASS | 自动重启 spawn 新实例 |


---

## 附录 B：第四轮实测验证记录（2026-08-17）

真实进程验证（隔离 DSH_HOME，未触碰用户数据；用户 GUI 15597 全程零影响）：

| # | 场景 | 结果 |
|---|------|------|
| V1 | 三重校验·etime 法（真实 dsh，正确台账时间） | ✅ 匹配 |
| V2 | 三重校验·PID 复用（台账时间早/晚 5min） | ✅ 不匹配，不杀 |
| V3 | R19 分类·应用签名孤儿（`--patch desktop-tools.patch.yml`） | ✅ app-orphan |
| V4 | R19 分类·手动实例（`dsh web` 无 patch，含用户 GUI） | ✅ manual |
| V5 | 进程组击杀 `kill -TERM -<pgid>`（真实孤儿，ppid=1） | ✅ 整组击杀确认死亡 |
| V6 | 迁移场景：台账 pid 已死 + 台账外带签名孤儿 | ✅ 识别为应用遗留并询问回收 |
| V7 | 隔离 DSH_HOME 零污染 | ✅ 真实 ~/.dsh 无新增 |
| V8 | 用户 GUI 完好（3080 返回 200） | ✅ |

实测发现并修复：R26（lstart 中文 locale → Date.parse NaN，改用 etime）、R27（macOS ps command 截断，改用关键子串匹配）。
