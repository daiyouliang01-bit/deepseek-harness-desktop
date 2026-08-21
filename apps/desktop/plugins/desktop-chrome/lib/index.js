/**
 * @dshd/desktop-chrome — host half (desktop DSH_HOME only).
 *
 * Slash-menu descriptions come from host command metadata (English in
 * official plugins). We do not edit official packages; we wrap
 * `commands.list` so the desktop UI sees Chinese copy.
 */
const ZH_DESCRIPTION = {
  compact: '压缩较早的会话历史',
  export: '将会话日志下载为 ZIP 压缩包',
  feedback: '为本会话记录反馈',
  goal: '设置或查看长期任务的目标',
  permission: '切换权限预设（沙箱模式 + 审批策略）',
  plan: '进入或退出计划模式',
}

function translateRow(row) {
  const zh = ZH_DESCRIPTION[row.name]
  if (!zh || row.description === zh) return row
  return {
    name: row.name,
    description: zh,
    ...(row.input ? { input: row.input } : {}),
  }
}

export default {
  name: 'desktop-chrome',
  inject: ['commands'],
  apply(ctx) {
    const commands = ctx.commands
    const orig = commands.list.bind(commands)
    const wrapped = function list(agent) {
      return orig(agent).map(translateRow)
    }
    try {
      commands.list = wrapped
    } catch {
      try {
        Object.defineProperty(commands, 'list', { configurable: true, writable: true, value: wrapped })
      } catch {
        /* official list() stays English — never block boot */
      }
    }
  },
}
