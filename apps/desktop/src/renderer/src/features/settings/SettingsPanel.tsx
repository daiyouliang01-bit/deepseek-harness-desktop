import type { Tokens } from '@dshd/ui'
import type { RuntimeStatus } from '@electron/runtime/runtime-types'

interface SettingsPanelProps {
  tokens: Tokens
  status: RuntimeStatus | null
  onRestart: () => void
  onStop: () => void
  onOpenLogs: () => void
  onBackToOfficial: () => void
}

/**
 * Task 3.1 settings panel. Runtime controls + model/provider placeholders.
 * API key entry is intentionally NOT in the renderer (safeStorage lives in
 * the main process — Task 3.5 adds the onboarding/key UI via IPC).
 */
export function SettingsPanel({
  tokens,
  status,
  onRestart,
  onStop,
  onOpenLogs,
  onBackToOfficial
}: SettingsPanelProps): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${space.sm}px 0`,
    borderBottom: `1px solid ${colors.border}`
  }
  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ color: colors.text, fontSize: font.sizeXl, marginBottom: space.md }}>Settings</h2>

      <section style={{ background: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.md }}>
        <h3 style={{ color: colors.text, fontSize: font.sizeLg, margin: `0 0 ${space.sm}px` }}>Runtime</h3>
        <div style={row}>
          <span style={{ color: colors.textMuted }}>State</span>
          <span style={{ color: colors.text, fontFamily: font.mono }}>{status?.state ?? 'unknown'}</span>
        </div>
        {status?.pid !== undefined && (
          <div style={row}>
            <span style={{ color: colors.textMuted }}>PID</span>
            <span style={{ color: colors.text, fontFamily: font.mono }}>{status.pid}</span>
          </div>
        )}
        {status?.ready && (
          <div style={row}>
            <span style={{ color: colors.textMuted }}>URL</span>
            <span style={{ color: colors.text, fontFamily: font.mono, fontSize: font.sizeSm }}>{status.ready.url}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: space.sm, marginTop: space.md }}>
          <button onClick={onRestart}>Restart runtime</button>
          <button onClick={onStop}>Stop</button>
          <button onClick={onOpenLogs}>Open logs</button>
        </div>
      </section>

      <section style={{ background: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.md }}>
        <h3 style={{ color: colors.text, fontSize: font.sizeLg, margin: `0 0 ${space.sm}px` }}>Model & Provider</h3>
        <div style={row}>
          <span style={{ color: colors.textMuted }}>Provider</span>
          <span style={{ color: colors.text }}>deepseek-official (managed by runtime)</span>
        </div>
        <div style={row}>
          <span style={{ color: colors.textMuted }}>Model</span>
          <span style={{ color: colors.text }}>deepseek-v4-flash (runtime default)</span>
        </div>
        <div style={row}>
          <span style={{ color: colors.textMuted }}>API key</span>
          <span style={{ color: colors.success }}>managed in OS keychain (main process)</span>
        </div>
      </section>

      <section style={{ background: colors.surface, borderRadius: radius.md, padding: space.md }}>
        <h3 style={{ color: colors.text, fontSize: font.sizeLg, margin: `0 0 ${space.sm}px` }}>Official Web UI</h3>
        <p style={{ color: colors.textMuted, fontSize: font.sizeSm, margin: `0 0 ${space.sm}px` }}>
          The official Harness Web UI remains available behind this diagnostic toggle until this shell reaches MVP parity.
        </p>
        <button onClick={onBackToOfficial}>Open official UI</button>
      </section>
    </div>
  )
}
