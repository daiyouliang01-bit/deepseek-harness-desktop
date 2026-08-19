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

/**
 * Claude-style narrow icon rail (64px). Labels move to `title` tooltips; the
 * chat list lives in its own column (ConversationList), not inside this rail.
 */
export function Sidebar({ tokens, view, onNavigate, runtimeState, updateBadge }: SidebarProps): React.JSX.Element {
  const { colors, space, radius } = tokens
  return (
    <nav
      style={{
        width: 64,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: `${space.md}px ${space.xs}px`
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 18,
          marginBottom: space.lg,
          color: colors.text,
          userSelect: 'none'
        }}
        title="DeepSeek Harness"
      >
        ⌘
      </div>
      {NAV.map((item) => (
        <button
          key={item.view}
          onClick={() => onNavigate(item.view)}
          title={item.label}
          aria-label={item.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            marginBottom: space.xs,
            border: 0,
            borderRadius: radius.md,
            cursor: 'pointer',
            fontSize: 20,
            background: view === item.view ? colors.surfaceAlt : 'transparent',
            color: view === item.view ? colors.accent : colors.textMuted,
            position: 'relative'
          }}
        >
          <span>{item.icon}</span>
          {updateBadge && item.view === 'settings' && (
            <span
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 8,
                height: 8,
                borderRadius: 99,
                background: colors.danger
              }}
              title="更新已下载，重启以安装"
            />
          )}
        </button>
      ))}
      <div
        style={{
          marginTop: 'auto',
          fontSize: 10,
          color: colors.textMuted,
          textAlign: 'center'
        }}
        title={`runtime: ${runtimeState}`}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: runtimeState === 'ready' ? colors.success : colors.warn,
            display: 'inline-block'
          }}
        />
      </div>
    </nav>
  )
}
