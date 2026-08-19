import type { Tokens } from '@dshd/ui'

export type ShellView = 'conversations' | 'projects' | 'phone' | 'settings'

interface SidebarProps {
  tokens: Tokens
  view: ShellView
  onNavigate: (view: ShellView) => void
  runtimeState: string
  /** P1: an update is downloaded and awaits restart → show a badge on Settings. */
  updateBadge?: boolean
}

const NAV: Array<{ view: ShellView; label: string; icon: string }> = [
  { view: 'conversations', label: 'Conversations', icon: '💬' },
  { view: 'projects', label: 'Projects', icon: '📁' },
  { view: 'phone', label: 'Phone', icon: '📱' },
  { view: 'settings', label: 'Settings', icon: '⚙️' }
]

export function Sidebar({ tokens, view, onNavigate, runtimeState, updateBadge }: SidebarProps): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  return (
    <nav
      style={{
        width: 220,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        padding: space.md
      }}
    >
      <div style={{ fontWeight: 700, fontSize: font.sizeLg, marginBottom: space.lg, color: colors.text }}>
        DeepSeek Harness
      </div>
      {NAV.map((item) => (
        <button
          key={item.view}
          onClick={() => onNavigate(item.view)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: space.sm,
            padding: `${space.sm}px ${space.md}px`,
            marginBottom: space.xs,
            border: 0,
            borderRadius: radius.sm,
            cursor: 'pointer',
            fontSize: font.sizeMd,
            textAlign: 'left',
            background: view === item.view ? colors.surfaceAlt : 'transparent',
            color: view === item.view ? colors.accent : colors.textMuted
          }}
        >
          <span>{item.icon}</span>
          {item.label}
          {updateBadge && item.view === 'settings' && (
            <span
              style={{
                marginLeft: 'auto',
                background: colors.danger,
                color: '#fff',
                borderRadius: 99,
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                fontSize: 10,
                lineHeight: '16px',
                textAlign: 'center'
              }}
              title="更新已下载，重启以安装"
            >
              ●
            </span>
          )}
        </button>
      ))}
      <div style={{ marginTop: 'auto', fontSize: font.sizeSm, color: colors.textMuted }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.xs }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: runtimeState === 'ready' ? colors.success : colors.warn,
              display: 'inline-block'
            }}
          />
          runtime: {runtimeState}
        </div>
      </div>
    </nav>
  )
}
