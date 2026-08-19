# 把手机端打成 iOS 应用：要做什么、有什么风险

> 版本：v1.1（第 1–2 轮对抗已并入 R1–R18）
> 状态：计划（未实现）
> 时间：2026-08-19
> 依赖：`docs/qr-pair-permanent-link-plan.md` v1.3（固定域名、只绑本机桌面、只跟 live + 工作流）

---

## 0. 结论先行

**不要一上来做 App Store 原生 App。** 你的手机端本质是「遥控自己那台开着 DSH 的电脑」，桌面关机就没用。这和 App Store 对「壳浏览器 / 远程控制 / 未审核的动态能力」都很敏感。

推荐三条路，按投入从低到高：

| 档 | 形态 | 给谁用 | 要不要苹果账号 | 建议 |
|----|------|--------|----------------|------|
| A | Safari / 添加到主屏幕（PWA） | 你自己 | 否 | **先做完**，几乎零成本 |
| B | 个人/企业签的 WKWebView 壳（TestFlight 或本机安装） | 你自己、家里人 | 个人 $99/年 或 免费的个人签名（7 天要重签） | **真要「图标」时再做** |
| C | 原生 Swift 重写 + 上架 App Store | 公开用户 | $99/年 + 审核 | **现在不要做** |

本计划默认目标是 **B**，并写清 C 为什么危险。A 是 B 的前置：`/phn`、扫码绑定、live SSE 必须先在浏览器里稳定。

**一句话：** iOS 应用只是更会存 cookie、能扫码、能后台保活一点的 Safari；电脑仍必须在线，隧道仍必须通，绑定仍只绑你这台桌面。

---

## 1. 现状（打包装进去的是什么）

```
iPhone
  → https://dsh.dpharness.xyz   （named tunnel，已核实固定）
  → 本机 127.0.0.1:35881 PIN 门
  → 注入 companion → 35880 /phn
```

手机页能力：会话列表、`/phn` 控制台、SSE（计划扩成 live 工作流）。  
还没稳的：扫码永久绑定（源码有，**打包 .app 主进程还没带上**）、桌面多开 dsh 会把壳打挂。

iOS 应用 **不能** 替代：桌面 DSH、cloudflared、PIN 门、设备表。它只是客户端。

---

## 2. 目标与非目标

### 目标（档 B）

1. 手机主屏幕一个图标，打开就是已绑定的 `/phn`（只跟正在跑的任务 + 实时工作流）。
2. 首次：扫桌面 QR 完成绑定（系统相机或应用内扫码）。
3. 以后：自动带上设备身份，不再每次输 PIN。
4. 桌面离线 / 隧道挂了：应用内明确「电脑未开机」，不要白屏。
5. 桌面「解除设备」后，下次打开立刻失效。

### 非目标

- 不上 App Store（除非你以后单独立项）。
- 不做离线看完全部历史（178 条正文）。
- 不在 App 里再开一条隧道、不绑别人的电脑。
- 不把 companion / PIN 写进 IPA。

### 红线

1. 设备密钥只进 **Keychain**（或 WKWebView 的 HttpOnly cookie），不进 UserDefaults、不进 iCloud 备份明文。
2. App 只信任 `https://dsh.dpharness.xyz`（ATS；禁止任意 URL 套壳）。
3. 桌面撤销必须立刻生效，App 不得缓存「已登录」绕过服务端。
4. 不确定时显示错误，不假装在线。

---

## 3. 推荐架构（档 B：WKWebView 壳）

```
SwiftUI App
  ├─ 启动：探活 GET https://dsh.dpharness.xyz/__health 或 /phn
  │     失败 → 「请打开电脑上的 DSH Desktop」
  ├─ 未绑定：相机扫 QR（内容只能是 https://dsh.dpharness.xyz/__pair?t=…）
  │     WKWebView 打开该 URL → 门种 cookie → 进 /phn
  └─ 已绑定：WKWebView 直接 load /phn
        cookie 由 WKWebsiteDataStore 持久化
        SSE 走同一 WebView（与现在浏览器相同）
```

**不要**在 Swift 里再实现一套 Agent 协议。第一版就是受控浏览器：

- `WKAppBoundDomains` 绑死 `dsh.dpharness.xyz`
- 拦截导航：不是该 host 的 `https` 一律取消
- QR 校验：host、path=`/__pair`、必须有 `t=`，否则拒绝

档 A（PWA）只需：`/phn` 补 `manifest` + apple-touch-icon + `apple-mobile-web-app-capable`。用户用 Safari 分享 → 添加到主屏幕。cookie 仍受 Safari 限制，但能验证产品。

档 C（原生）：用 URLSession + 自绘工作流。工作量是壳的 5–10 倍，且要稳定 JSON API（现在 SSE 字段还在扩）。等 `/phn` API 冻结再考虑。

---

## 4. 你要做的事（清单）

### 4.1 桌面侧（先做，否则 App 没有可包的后端）

| # | 事项 | 为何 |
|---|------|------|
| D1 | 扫码绑定在 **源码桌面** 跑通（`.app` 旧主进程没有 `pairMint`） | App 第一次绑定靠 `/__pair` |
| D2 | 设备 cookie + 撤销落盘 | 否则「App 永久登录」是假的 |
| D3 | `/phn` 只跟 live + SSE 工作流 | App 打开才不会拉 178 条正文 |
| D4 | 桌面只开一个 dsh（关掉多余 `npm exec dsh web`） | 否则壳启动被 task-board 锁打死 |
| D5 | 健康口给客户端用：未认证也可判断「门活着」（不要泄露 PIN 是否已设的细节之外的东西） | App 启动探活 |

### 4.2 iOS 工程

| # | 事项 | 说明 |
|---|------|------|
| I1 | Mac + Xcode（最新稳定版） | 没有 Windows 替代 |
| I2 | Apple ID：真机长期用建议 **付费开发者**；免费签名 7 天过期 | 见风险 R6 |
| I3 | 新建 App：`ios/DSHPhone/`（SwiftUI + WKWebView） | 不要和桌面 Electron 混仓编译 |
| I4 | 权限：`NSCameraUsageDescription`（扫码）；不要开通讯录/定位 | 审核/用户信任 |
| I5 | ATS：只允许 `dsh.dpharness.xyz` | 禁止任意 http |
| I6 | Associated Domains（可选）`applinks:dsh.dpharness.xyz` | 扫系统相机也能跳进 App |
| I7 | 离线/错误页（原生，不依赖 Web） | 电脑关了也能看懂 |
| I8 | 设置页：解除本机绑定（清 WK 网站数据）+ 显示桌面「解除」说明 | 丢手机双撤销 |
| I9 | TestFlight 或 USB 装到你的 iPhone | 档 B 的交付物 |

### 4.3 发布选择（必须先定）

- **只给自己：** USB / 免费签名 / 内部 TestFlight。不要走审核。
- **给家人：** 付费账号 + TestFlight 内部测试（最多约 100 人，仍可不审商店）。
- **上架：** 单独评估，默认否（R1）。

### 4.4 建议实施顺序

1. 浏览器里把绑定 + live `/phn` 做稳（档 A）。  
2. 最小 WKWebView 壳，硬编码域名，TestFlight 给你自己。  
3. 再谈扫码 UX、推送、后台。  
4. 冻结 API 之前不做原生重写。

---

## 5. 风险（按严重度）

### 🔴 致命 / 不要假装没有

**R1 App Store 极大概率拒审或事后下架**  
应用功能是「远程驱动一台能写文件、跑命令的 Agent」。审核条款对远程桌面、未审核脚本、套壳网页都很严。纯 WKWebView 套网站也常以 4.2 最低功能拒。  
→ 本计划 **默认不上架**。要上架必须改成有实质原生 UI，并接受「远程执行」被拒的可能。

**R2 手机失窃 ≈ 电脑失窃**  
绑定后免 PIN。iOS 若未开锁屏，捡到手机就能指挥 Agent。  
→ 强制系统密码锁；桌面一键解除；App 进后台超 N 分钟需 Face ID（可选，档 B 第二期）。

**R3 套壳打开任意 URL = 钓鱼**  
用户若能在地址栏输入别的站，cookie/钥匙可能被骗。  
→ 域名白名单，QR 格式校验。

**R4 设备密钥进 iCloud 备份**  
默认网站数据可能进备份。  
→ `WKWebsiteDataStore` 尽量非同步到 iCloud；长期票优先 Keychain `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`。

**R5 桌面离线时用户以为 App 坏了**  
隧道、电脑休眠、多开 dsh 崩插件，都会「打不开」。  
→ 原生错误页写清原因；不要和「PIN 页」混为一谈。

### 🟡 重要

**R6 签名与过期**  
免费个人签 7 天；企业签有合规风险；付费账号设备数有限。  
→ 自用走付费 + TestFlight。

**R7 WKWebView cookie ≠ Safari cookie**  
在 Safari 绑过，App 里仍要再绑一次。这是正常隔离。  
→ 文案写明「App 与 Safari 不是同一份登录」。

**R8 iOS 杀后台，SSE 会断**  
锁屏后实时工作流停。  
→ 回前台重连 EventSource；不要承诺「口袋里一直直播」。推送需苹果证书和桌面侧推送网关，本期不做。

**R9 审核/ATS 与自签证书**  
named tunnel 已是正规 HTTPS，这点有利。不要改用自签。

**R10 中国区相机 / 网络权限文案**  
用途写「扫描桌面绑定码以连接你自己的电脑」，不要写「监控」。

**R11 与现有「两个 dsh 抢 profile」叠加**  
App 再稳，桌面插件树挂了一样打不开。先解决只跑一个 dsh。

**R12 法律与滥用**  
远程执行能力。仅绑定自己的机器；不要做成「任意人扫码控你电脑」的产品宣传。

### 🟢 次要

- 刘海 / 安全区、键盘挡住发送条（`viewport-fit=cover` 已有一部分）。  
- 微信里打开 QR 会丢 cookie → App 内扫码可避开。  
- 小屏幕 44pt 热区。  
- IPv6 / 运营商对 CF 的偶发劫持：错误页提供「重试」。

---

## 6. 对抗摘要

| ID | 级 | 发现 | 已并入 |
|----|----|------|--------|
| R1 | 🔴 | 上架会被当成远程控制/套壳 | 默认不上架 |
| R2 | 🔴 | 丢手机=丢电脑 | 解除 + 系统锁 |
| R3 | 🔴 | 任意 URL 套壳 | 白名单 |
| R4 | 🔴 | iCloud 备份密钥 | Keychain / 本机 |
| R5 | 🔴 | 离线被当成 App 坏了 | 原生错误页 |
| R6–R12 | 🟡 | 签名、cookie 隔离、SSE、权限文案、多 dsh、宣传 | §5 |
| R13 | 🟢 | 先做原生会和未稳的 `/phn` API 双份维护 | 先壳后原生 |
| R14 | 🟢 | Associated Domains 配错会扫码进 Safari | 可选，第二期 |
| R15 | 🟡 | 健康检查若返回是否已设 PIN，会泄露门状态 | 探活只答「门是否在」 |
| R16 | 🟢 | TestFlight 外链仍走 Safari，要再绑一次 | 文档说明 |
| R17 | 🟡 | App 里跑完整 Web（allowFullApp）审核更糟 | App 只 load `/phn` |
| R18 | 🟢 | 没有苹果电脑就做不了真机包 | 写进前置 |

第 3–5 轮未出新的 🔴。本计划可按档 A→B 执行；档 C 未收敛到「可以上架」。

---

## 7. 验收（档 B）

1. 电脑开着、隧道通：装好的 App 打开 3 秒内看到 live 空态或正在跑的任务。  
2. 电脑关着：看到「电脑未开机」，不是 WK 白屏。  
3. 扫一次合法 QR 后，杀进程再开 App，仍进 `/phn`（无需 PIN）。  
4. 桌面点解除后，再开 App 回到未绑定。  
5. 伪造 QR（别的域名）被拒绝。  
6. Charles 抓包：没有 companion、没有 PIN 明文出 App。  
7. 不提交 App Store 也可在 TestFlight/USB 自用。

---

## 8. 建议

**现在可以做的只有档 A，以及把桌面绑定做完。**  
档 B 等绑定 + live `/phn` 在 Safari 里连续一周好用再开 Xcode。  
档 C / 上架：单独决策，本计划明确 **不建议**。

你若确定要做壳，下一步是：Apple 账号用免费还是付费、App 是否只给你自己一台 iPhone。
