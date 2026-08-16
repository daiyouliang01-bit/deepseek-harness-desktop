# 图片拖拽解读/识别功能方案 v2（类似 GPT）

> 状态：v2（两轮独立审查 + 视觉能力真机探针后优化）。待用户确认后执行。
> 基于官方 wire 契约取证（`dsh-attachment`、`dsh-host-apiproxy`）+ 两轮
> 架构/UX 审查 + 视觉探针实测。

## 0. 用户旅程

```
拖拽/粘贴/文件选择 图片 → 输入区高亮 + 缩略图行（四态）→ 可选文字 + 发送
  → 主进程：只读文件头预检（魔数/尺寸/上限）→ 超像素自动压缩 → base64
  → session.prompt image part → 模型解读 → 流式回复
历史消息：含图消息 → session.attachment 懒加载回读 → 气泡内缩略图 + 点击放大
```

## 1. 官方 wire 取证（v1 已确认，保持）

- `ImageMediaType = png | jpeg | webp | gif`；`ImageAttachmentLimits` 五维上限
- `session.prompt` content 支持 `{type:'image', mediaType, data: base64, name?}`
- `session.attachment {sessionId, attachmentId} → {attachment, data}`
- 官方 UI 有 DropOverlay / ImageLightbox 参考

## 2. 视觉能力实测（v2 新增关键证据）

**探针结果**：发送 1×1 红 PNG + "这是什么颜色"，模型回答提及
"modlens vision bridge already read it: the image is completely black"——
① 确认模型**有视觉通道**；② 但颜色被读错（红→黑），说明小图/压缩/色彩
保真存在坑。**结论**：
- M1 必须加真机**色彩保真验证**（发送已知色块，断言模型回答匹配）
- 图片发送前不降采样到过小（保留 ≥ 常见视觉输入尺寸，如 512 边）

## 3. 设计（v2 修订）

### 3.1 渲染层

- **三入口统一**：拖拽 + 粘贴 + 「＋」文件选择，共用同一 intake pipeline
- **拖拽遮罩**：聚焦输入区描边高亮（保留已输入文字），分「悬停/可松开」
  两段文案，拖出窗口撤销；debounce 防闪烁
- **缩略图行四态**：排队（黄）→ 发送中（蓝转圈）→ 成功（绿，随消息气泡）
  → 失败（灰 + 图标 + 文案 + 重试/移除按钮，不阻塞其他图）
- **发送**：按钮显示「文字 + 图 N」计数；发送中允许继续输入（待发图与
  文本解耦）；失败保留草稿（base64 内存 + 文本）可重试
- **消息气泡**：图 + 文同一气泡；点击放大（Esc 关闭）；历史图懒加载
  （IntersectionObserver 进入视口才回读）+ 已读缓存
- **可访问性**：缩略图可 Tab 聚焦 + Delete 删除 + Enter 触发；`aria-live`
  播报状态；错误态三信号（颜色+图标+文案）；Esc 关遮罩/放大

### 3.2 主进程预检（v2 改为只读文件头，防解码炸弹）

`electron/attachments/image-intake.ts`：
- **只读头解析**：魔数（png/jpeg/webp/gif，不信扩展名/声明）+ 尺寸
  （IHDR/SOF/VP8 头），**绝不 full-decode 仅做校验**；拒 SVG/HTML（无魔数
  或 text/* 声明）
- **上限校验**：五维（单图字节/张数/消息总字节/像素/白名单）；超像素 →
  **自动 canvas 重采样压缩**（长边目标值，保留宽高比）再发，仍超才报错
  并给「压缩/跳过」动作；gif 超限保留首帧并注明
- **EXIF 剥离**（P1）：jpeg 发送前剥离 GPS/相机元数据
- **并发上限**：同时只处理 N 张（防 base64 内存峰值）；完成后 revoke
  objectURL

### 3.3 发送与协议

- `agent:send` payload：`{sessionId, text, images?: [{name, mediaType, dataB64}]}`
  （向后兼容）；新增 `agent:attachment(sessionId, attachmentId)`
- **错误 shape 统一**：`{ok, error?: {code, message, imageIndex?}}`——多图
  部分成功：返回 success/failed 下标，UI 只标失败那张
- **发送前 hasVision 检测**：查会话模型能力，无视觉则禁用加图 + 灰条提示
  （避免"发了被忽略"）
- **幂等**：requestId 去重，防重试重复持久化附件

### 3.4 安全与隐私

- 魔数白名单拒 SVG/HTML（防 XSS 经 <img>）
- 文件名 HTML 转义（防注入 alt/title）；name 剥离路径
- 图片只发当前会话；attachmentId 不透明
- 审计日志：何时/哪会话/发了几张图（不记内容）
- 本地不落盘明文（base64 仅内存传递；host 自身持久化除外）

## 4. 里程碑（v2 调整）

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0 视觉验证** | 真机色彩保真探针（红/蓝/绿色块断言）+ hasVision 检测 | 探针通过；无视觉模型时 UI 禁用加图 |
| **M1 预检与发送** | image-intake 只读头预检 + 自动压缩 + EXIF 剥离 + prompt 图片 part + 统一错误 shape | 单测（魔数伪装/超限/压缩/部分成功）；真机发图成功 |
| **M2 拖拽/粘贴 UI** | 三入口 + 遮罩 + 四态缩略图 + 草稿保留 + 可访问性 | 单测（jsdom）+ 手测清单 |
| **M3 历史图片回读** | 懒加载回读 + 缓存 + 放大 + 破图占位重试 | 真机历史会话图片可见 |
| **M4 打磨** | 发送中状态、多图布局、gif 首帧、失败 toast、性能（虚拟化） | 手测全流程 |

## 5. 风险与对策（v2 更新）

| 风险 | 对策 |
|---|---|
| 视觉保真（小图/压缩读错色） | M0 色彩探针；压缩下限保 512 边；色彩剖面实测 |
| 解码炸弹/像素炸弹 | 只读头预检，禁 full-decode；gif 帧数限制；尺寸上限 |
| SVG/HTML 伪装 | 魔数白名单显式拒；渲染仅经 attachment 回读 |
| EXIF/隐私泄露 | 发送前剥离；审计日志；隐私开关（P2） |
| 无视觉模型 | hasVision 前置检测 + 灰条 |
| 历史大量图片内存 | 懒加载 + 缓存 + 虚拟化（P1） |
| 官方 imageLimits 未知 | 从部署 projection 拉取，降级保守默认 |

## 6. 待确认（执行前）

1. **执行范围**：M0+M1+M2（发送方向）先上，还是 M0–M3 全做（含历史回读）？
2. **自动压缩阈值**：默认长边 2048px / 单图 5MB 超限才压缩，可接受吗？
3. **EXIF 剥离**：默认开启（隐私优先），还是做成设置项（默认开）？
4. gif 发送：保留动图原样（可能超帧限被拒）还是统一截首帧？

## 7. 审查记录

- v1 → v2：两轮独立审查（架构安全 × UX）+ 视觉探针实测
  - 采纳 P0：只读头预检、拒 SVG、hasVision 前置、自动压缩而非报错、
    失败可重试、四态缩略图、测试清单
  - 采纳 P1：EXIF 剥离、base64 峰值并发上限、revoke 审计、懒加载回读、
    统一错误 shape、部分成功、文件名转义、aria-live
  - 待办 P2：多图重排、隐私开关、压缩算法参数化、虚拟滚动
