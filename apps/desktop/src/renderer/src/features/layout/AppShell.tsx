import { darkTokens } from '@dshd/ui'
import { useState } from 'react'
import type { RuntimeStatus } from '@electron/runtime/runtime-types'
import { ConversationsPanel } from '../conversations/ConversationsPanel'
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
  const { colors } = tokens

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg, color: colors.text }}>
      <Sidebar tokens={tokens} view={view} onNavigate={setView} runtimeState={status?.state ?? 'idle'} />
      <main style={{ flex: 1, overflow: 'auto', padding: tokens.space.lg }}>
        {view === 'conversations' && <ConversationsPanel tokens={tokens} />}
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
