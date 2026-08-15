import type { Tokens } from '@dshd/ui'

export type ShellView = 'conversations' | 'projects' | 'settings'

interface SidebarProps {
  tokens: Tokens
  view: ShellView
  onNavigate: (view: ShellView) => void
  runtimeState: string
}

const NAV: Array<{ view: ShellView; label: string; icon: string }> = [
  { view: 'conversations', label: 'Conversations', icon: '💬' },
  { view: 'projects', label: 'Projects', icon: '📁' },
  { view: 'settings', label: 'Settings', icon: '⚙️' }
]

export function Sidebar({ tokens, view, onNavigate, runtimeState }: SidebarProps): React.JSX.Element {
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
