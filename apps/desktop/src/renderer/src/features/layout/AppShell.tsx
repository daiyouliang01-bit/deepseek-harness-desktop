import { darkTokens } from '@dshd/ui'
import { useEffect, useState } from 'react'
import type { RuntimeStatus } from '@electron/runtime/runtime-types'
import { ChatView } from '../chat/ChatView'
import { ConversationsPanel } from '../conversations/ConversationsPanel'
import { Onboarding } from '../onboarding/Onboarding'
import { PhonePanel } from '../phone/PhonePanel'
import { ProjectsPanel } from '../projects/ProjectsPanel'
import { SettingsPanel } from '../settings/SettingsPanel'
import { Sidebar, type ShellView } from '../sidebar/Sidebar'

interface AppShellProps {
  status: RuntimeStatus | null
  onRestart: () => void
  onStop: () => void
  onOpenLogs: () => void
  onBackToOfficial: () => void
}

/**
 * Task 3.1 application shell: sidebar + feature panels. Replaces the official
 * Web UI once it reaches MVP parity (kept behind a diagnostic toggle).
 */
export function AppShell({
  status,
  onRestart,
  onStop,
  onOpenLogs,
  onBackToOfficial
}: AppShellProps): React.JSX.Element {
  const tokens = darkTokens
  const [view, setView] = useState<ShellView>('conversations')
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [updateBadge, setUpdateBadge] = useState(false)
  const [rollbackSuggested, setRollbackSuggested] = useState<{ version: string | null } | null>(null)
  const { colors } = tokens

  // P1: update badge — an update is downloaded and awaits restart.
  useEffect(() => {
    void window.desktop.updateGetState().then((s) => setUpdateBadge(s?.status === 'downloaded'))
    return window.desktop.onUpdateState((s) => setUpdateBadge(s.status === 'downloaded'))
  }, [])

  // Crash-evidence: previous run crashed while an update was pending → offer rollback.
  useEffect(() => {
    void window.desktop.crashEvidenceGet().then((r) => {
      if (r.rollbackSuggested) setRollbackSuggested({ version: r.previousVersion })
    })
  }, [])

  // First-run gate (Task 3.5): show onboarding until a key is configured.
  // The phone panel (PIN / tunnel) is exempt — it needs no API key.
  const needsOnboarding = keyConfigured === false && view !== 'phone'
  useEffect(() => {
    void window.desktop.listKeys().then((keys) => setKeyConfigured(keys.some((k) => k.configured)))
  }, [])

  // Custom-shell navigation (tray / menu): jump to the requested view.
  useEffect(() => {
    return window.desktop.onOpenShell((viewArg) => {
      if (viewArg === 'phone' || viewArg === 'settings' || viewArg === 'projects' || viewArg === 'conversations') {
        setView(viewArg)
      }
    })
  }, [])

  // Phone panel is always reachable (PIN/tunnel need no API key): render it
  // before the onboarding gate so the floating button works on first run.
  if (view === 'phone') {
    return (
      <div style={{ display: 'flex', height: '100vh', background: colors.bg, color: colors.text }}>
        <Sidebar tokens={tokens} view={view} onNavigate={setView} runtimeState={status?.state ?? 'idle'} updateBadge={updateBadge} />
        <main style={{ flex: 1, overflow: 'auto', padding: tokens.space.lg }}>
          <PhonePanel tokens={tokens} />
        </main>
      </div>
    )
  }

  if (needsOnboarding) {
    return (
      <div style={{ height: '100vh', background: colors.bg, color: colors.text, overflow: 'auto' }}>
        <Onboarding tokens={tokens} onComplete={() => setKeyConfigured(true)} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg, color: colors.text }}>
      <Sidebar tokens={tokens} view={view} onNavigate={setView} runtimeState={status?.state ?? 'idle'} updateBadge={updateBadge} />
      <main style={{ flex: 1, overflow: 'auto', padding: tokens.space.lg }}>
        {rollbackSuggested && (
          <div
            style={{
              background: colors.surface,
              border: `1px solid ${colors.warn}`,
              borderRadius: 8,
              padding: `${tokens.space.sm}px ${tokens.space.md}px`,
              marginBottom: tokens.space.md,
              color: colors.text
            }}
          >
            ⚠ 上次启动在更新后异常退出。新版本可能未正确安装
            {rollbackSuggested.version ? `（pending ${rollbackSuggested.version}）` : ''}。
            如反复如此，请从设置中检查版本，或回退到上一版本。
          </div>
        )}
        {view === 'conversations' && (
          <div style={{ display: 'flex', gap: tokens.space.lg }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <ConversationsPanel tokens={tokens} activeSessionId={activeSessionId} onSelect={setActiveSessionId} />
            </div>
            <div style={{ flex: 2 }}>
              <ChatView tokens={tokens} activeSessionId={activeSessionId} />
            </div>
          </div>
        )}
        {view === 'projects' && <ProjectsPanel tokens={tokens} />}
        {view === 'settings' && (
          <SettingsPanel
            tokens={tokens}
            status={status}
            onRestart={onRestart}
            onStop={onStop}
            onOpenLogs={onOpenLogs}
            onBackToOfficial={onBackToOfficial}
          />
        )}
      </main>
    </div>
  )
}
