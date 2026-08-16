import { darkTokens } from '@dshd/ui'
import { useEffect, useState } from 'react'
import type { RuntimeStatus } from '@electron/runtime/runtime-types'
import { ChatView } from '../chat/ChatView'
import { ConversationsPanel } from '../conversations/ConversationsPanel'
import { Onboarding } from '../onboarding/Onboarding'
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
  const { colors } = tokens

  // First-run gate (Task 3.5): show onboarding until a key is configured.
  useEffect(() => {
    void window.desktop.listKeys().then((keys) => setKeyConfigured(keys.some((k) => k.configured)))
  }, [])

  if (keyConfigured === false) {
    return (
      <div style={{ height: '100vh', background: colors.bg, color: colors.text, overflow: 'auto' }}>
        <Onboarding tokens={tokens} onComplete={() => setKeyConfigured(true)} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg, color: colors.text }}>
      <Sidebar tokens={tokens} view={view} onNavigate={setView} runtimeState={status?.state ?? 'idle'} />
      <main style={{ flex: 1, overflow: 'auto', padding: tokens.space.lg }}>
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
