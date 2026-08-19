/** Chinese catalog, web-ui feature map, and disabled-row parsing. */

export const WEB_UI_ALL = '@linxin666/dsh-web-ui-all'
export const WEB_UI_SETTINGS = '@linxin666/dsh-client-ui-web-ui-settings'

/** Feature rows shipped by the web-ui-all bundle. */
export const WEB_UI_FEATURES = [
  { id: 'web-ui-settings', name: WEB_UI_SETTINGS, title: 'Web UI 设置页', summary: '全家桶开关页，没有独立能力', hidden: true },
  { id: 'web-ui-community-plugins', name: '@linxin666/dsh-client-ui-community-plugins', title: '社区插件市场', summary: '浏览并安装社区插件' },
  { id: 'web-ui-dsh-aionui-panel', name: '@linxin666/dsh-client-ui-aionui-panel', title: 'AI 面板', summary: '侧栏里的 AI 辅助面板' },
  { id: 'web-ui-task-board', name: '@linxin666/dsh-client-ui-task-board', title: '任务看板', summary: '多列看板、定时任务和工作流结算' },
  { id: 'web-ui-git-graph', name: '@linxin666/dsh-client-ui-git-graph', title: 'Git 提交图', summary: '在侧栏查看提交历史与分支' },
  { id: 'web-ui-pet', name: '@linxin666/dsh-pet', title: '桌宠', summary: '桌面上的小宠物挂件' },
  { id: 'web-ui-remote-web-ui', name: '@linxin666/dsh-remote-web-ui', title: '远程 Web UI', summary: '另一套扫码远程，已由本机手机页替代' },
  { id: 'web-ui-ssh', name: '@linxin666/dsh-ssh', title: 'SSH 面板', summary: '在界面里开 SSH 会话' },
  { id: 'web-ui-describe-image', name: '@linxin666/dsh-tool-describe-image', title: '读图工具', summary: '给模型补充看图能力' },
  { id: 'web-ui-liangshen', name: '@linxin666/dsh-liangshen', title: '良神皮肤', summary: '额外主题皮肤' },
  { id: 'web-ui-skill-explorer', name: '@linxin666/dsh-client-ui-skill-explorer', title: '技能浏览', summary: '浏览和打开已装技能' },
  { id: 'web-ui-skin-center', name: '@linxin666/dsh-client-ui-skin-center', title: '皮肤中心', summary: '切换社区皮肤' },
]

const PLUGIN_ZH = {
  '@dsh-external/dsh-automation': { title: '定时自动化', summary: '按计划开新会话跑任务' },
  '@dshd/coding-agent-host': { title: '编程代理宿主', summary: '给编程代理提供宿主行' },
  '@dshd/community-links': { title: '社区链接', summary: 'Awesome DSH 与橙皮书入口' },
  '@dshd/dsh-installed': { title: '已安装账本', summary: '列出本机插件和技能，并检查更新' },
  '@dshd/phone-settings': { title: '手机访问', summary: '设置页里的隧道、扫码绑定和 PIN' },
  '@dshd/phone-sync': { title: '手机同步', summary: '手机页、隧道和实时会话' },
  [WEB_UI_ALL]: { title: 'Web UI 全家桶', summary: '聚合包本身没有界面，更新时只动本机还在用的功能' },
  [WEB_UI_SETTINGS]: { title: 'Web UI 设置页', summary: '全家桶开关页，没有独立能力' },
  '@liustack/modlens': { title: '免费看图', summary: '给纯文本模型补视觉' },
  '@omdsh-dev/dsh-genui': { title: 'GenUI 交互界面', summary: '回复里渲染可交互卡片' },
  'dsh-better-sidebar': { title: '右侧工作台', summary: '文件、终端、Git、浏览器侧栏' },
  'dsh-context': { title: '会话上下文', summary: '把当前会话上下文钉在界面上' },
  'dsh-free-vision': { title: '免费视觉', summary: '免费看图通道' },
  'dsh-xai': { title: 'xAI / Grok', summary: '接入 Grok 模型' },
  dsh1024: { title: '1024 商店', summary: '插件市场（本机已停用）' },
}

/**
 * @param {string} name
 * @param {string} [fallback]
 */
export function chineseOf(name, fallback = '') {
  const hit = PLUGIN_ZH[name]
  if (hit) return hit
  const feature = WEB_UI_FEATURES.find((row) => row.name === name)
  if (feature) return { title: feature.title, summary: feature.summary }
  return { title: name, summary: fallback }
}

/**
 * Parse `disabled: true` rows from a cordis patch YAML.
 * @param {string} text
 */
export function readDisabledIds(text) {
  const ids = new Set()
  const lines = String(text ?? '').split(/\r?\n/)
  let pending = null
  for (const raw of lines) {
    const idMatch = /^-\s+id:\s+['"]?([A-Za-z0-9_@./-]+)['"]?\s*$/.exec(raw)
    if (idMatch) {
      pending = idMatch[1]
      continue
    }
    if (pending && /^\s+disabled:\s+true\s*$/.test(raw)) {
      ids.add(pending)
      pending = null
      continue
    }
    if (raw.startsWith('- ') || raw.startsWith('#')) pending = null
  }
  return ids
}

/**
 * @param {string} name
 */
export function featureByName(name) {
  return WEB_UI_FEATURES.find((row) => row.name === name) ?? null
}

/**
 * @param {Set<string>} disabled
 * @param {string} name
 */
export function isFeatureEnabled(disabled, name) {
  if (name === WEB_UI_SETTINGS) return false
  const feature = featureByName(name)
  if (!feature) return !disabled.has(name)
  if (feature.hidden) return false
  return !disabled.has(feature.id)
}

/**
 * Default apply list: locally present, still-enabled, not hidden.
 * @param {Array<Record<string, unknown>>} items
 * @param {Set<string>} disabled
 */
export function localUpdateTargets(items, disabled) {
  return items.filter((item) => {
    if (item.name === WEB_UI_ALL || item.name === WEB_UI_SETTINGS) return false
    if (item.origin === 'local') return false
    if (!isFeatureEnabled(disabled, String(item.name))) return false
    const update = /** @type {Record<string, unknown> | undefined} */ (item.update)
    return update?.status === 'available'
  })
}

/**
 * Complete-update candidates: every non-local available row, including removed ones.
 * @param {Array<Record<string, unknown>>} items
 */
export function completeUpdateTargets(items) {
  return items.filter((item) => {
    if (item.name === WEB_UI_SETTINGS) return false
    if (item.origin === 'local') return false
    const update = /** @type {Record<string, unknown> | undefined} */ (item.update)
    return update?.status === 'available'
  })
}

/**
 * Attach Chinese copy and enabled/hidden flags. The aggregate card is kept
 * out of the everyday list; its children surface as separate rows.
 * @param {Array<Record<string, unknown>>} plugins
 * @param {{ disabled?: Set<string>, featureVersions?: Record<string, string> }} extra
 */
export function decoratePlugins(plugins, extra = {}) {
  const disabled = extra.disabled ?? new Set()
  const versions = extra.featureVersions ?? {}
  const out = []
  for (const plugin of plugins) {
    if (plugin.name === WEB_UI_ALL || plugin.name === WEB_UI_SETTINGS) continue
    const zh = chineseOf(String(plugin.name), String(plugin.description || ''))
    const feature = featureByName(String(plugin.name))
    const enabled = isFeatureEnabled(disabled, String(plugin.name))
    if (!enabled) continue
    out.push({
      ...plugin,
      titleZh: zh.title,
      summaryZh: zh.summary,
      description: zh.summary || plugin.description,
      enabled,
    })
  }

  const hasBundle = plugins.some((plugin) => plugin.name === WEB_UI_ALL)
  if (hasBundle) {
    for (const feature of WEB_UI_FEATURES) {
      if (feature.hidden) continue
      if (out.some((item) => item.name === feature.name)) continue
      if (!isFeatureEnabled(disabled, feature.name)) continue
      const version = versions[feature.name] ?? null
      out.push({
        kind: 'plugin',
        id: feature.name,
        name: feature.name,
        version,
        spec: version ? `^${version}` : 'latest',
        description: feature.summary,
        origin: 'npm',
        homepage: null,
        github: null,
        titleZh: feature.title,
        summaryZh: feature.summary,
        enabled: true,
        fromBundle: true,
      })
    }
  }

  return out.sort((left, right) => String(left.titleZh || left.name).localeCompare(String(right.titleZh || right.name), 'zh'))
}

/**
 * Rows shown in the complete-update picker (includes removed-but-present features).
 * @param {Array<Record<string, unknown>>} plugins
 * @param {Set<string>} disabled
 * @param {Record<string, string>} [featureVersions]
 */
export function decorateCompleteCandidates(plugins, disabled, featureVersions = {}) {
  const everyday = decoratePlugins(plugins, { disabled, featureVersions })
  const byName = new Map(everyday.map((item) => [item.name, item]))
  if (!plugins.some((plugin) => plugin.name === WEB_UI_ALL)) return everyday
  for (const feature of WEB_UI_FEATURES) {
    if (feature.hidden || byName.has(feature.name)) continue
    byName.set(feature.name, {
      kind: 'plugin',
      id: feature.name,
      name: feature.name,
      version: featureVersions[feature.name] ?? null,
      spec: featureVersions[feature.name] ? `^${featureVersions[feature.name]}` : 'latest',
      description: feature.summary,
      origin: 'npm',
      homepage: null,
      github: null,
      titleZh: feature.title,
      summaryZh: feature.summary,
      enabled: false,
      fromBundle: true,
      removed: true,
    })
  }
  return [...byName.values()].sort((left, right) => String(left.titleZh || left.name).localeCompare(String(right.titleZh || right.name), 'zh'))
}

/**
 * @param {string} current
 * @param {string} latest
 * @param {string} summary
 */
export function noteZh(current, latest, summary) {
  const from = current ? `从 v${current} ` : ''
  const to = latest ? `升到 v${latest}` : '有新版本'
  const extra = summary ? `。${summary}` : ''
  return `${from}${to}${extra}`
}
