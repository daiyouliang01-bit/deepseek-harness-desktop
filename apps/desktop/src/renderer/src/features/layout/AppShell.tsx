import { darkTokens } from '@dshd/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
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

// --- P2 layout preferences (external review item #3, slice 1) ---

interface LayoutPrefs {
  /** Left nav rail hidden. */
  sidebarCollapsed: boolean
  /** Conversations panel share of the split, percent (clamped 20–65). */
  convPct: number
  /** Focus mode: sidebar + conversations hidden, chat takes everything. */
  focusMode: boolean
}

const LAYOUT_KEY = 'dshd.layout.v1'
const LAYOUT_DEFAULTS: LayoutPrefs = { sidebarCollapsed: false, convPct: 32, focusMode: false }
const CONV_PCT_MIN = 20
const CONV_PCT_MAX = 65

function loadLayoutPrefs(): LayoutPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Partial<LayoutPrefs>
    const pct =
      typeof raw.convPct === 'number' && Number.isFinite(raw.convPct)
        ? Math.min(CONV_PCT_MAX, Math.max(CONV_PCT_MIN, raw.convPct))
        : LAYOUT_DEFAULTS.convPct
    return {
      sidebarCollapsed: raw.sidebarCollapsed === true,
      convPct: pct,
      focusMode: raw.focusMode === true
    }
  } catch {
    return LAYOUT_DEFAULTS
  }
}

/**
 * Task 3.1 application shell: sidebar + feature panels. Replaces the official
 * Web UI once it reaches MVP parity (kept behind a diagnostic toggle).
 *
 * P2 layout slice: collapsible nav rail, draggable conversations/chat split,
 * focus mode (⌘/Ctrl+Shift+F), all persisted to localStorage.
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
  const [prefs, setPrefs] = useState<LayoutPrefs>(loadLayoutPrefs)
  const { colors, radius } = tokens

  const setLayout = useCallback((patch: Partial<LayoutPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(next))
      } catch {
        /* private mode etc. — session-only layout is fine */
      }
      return next
    })
  }, [])

  // Focus-mode keyboard toggle (⌘/Ctrl+Shift+F).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setLayout({ focusMode: !prefs.focusMode })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prefs.focusMode, setLayout])

  // Split-drag state: pointer capture on the handle, % delta against container.
  const splitRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ startX: number; startPct: number } | null>(null)

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

  // Task-completion notifications deep-link into the finished conversation.
  useEffect(() => {
    return window.desktop.onSetSession((sessionId) => {
      setActiveSessionId(sessionId)
      setView('conversations')
    })
  }, [])

  const showSidebar = !prefs.sidebarCollapsed && !prefs.focusMode

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

  const controlBtn: React.CSSProperties = {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    background: colors.surface,
    color: colors.textMuted,
    cursor: 'pointer',
    fontSize: 12,
    padding: '4px 8px'
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: colors.bg, color: colors.text, position: 'relative' }}>
      {/* Layout controls (top-right, out of content flow) */}
      <div style={{ position: 'absolute', top: tokens.space.sm, right: tokens.space.md, zIndex: 50, display: 'flex', gap: tokens.space.xs }}>
        <button
          onClick={() => setLayout({ focusMode: !prefs.focusMode })}
          title="专注模式（⌘/Ctrl+Shift+F）"
          style={{ ...controlBtn, color: prefs.focusMode ? colors.accent : colors.textMuted }}
        >
          {prefs.focusMode ? '退出专注' : '专注模式'}
        </button>
        {!prefs.focusMode && (
          <button
            onClick={() => setLayout({ sidebarCollapsed: !prefs.sidebarCollapsed })}
            title="折叠 / 展开侧栏"
            style={controlBtn}
          >
            {prefs.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          </button>
        )}
      </div>

      {showSidebar && (
        <Sidebar tokens={tokens} view={view} onNavigate={setView} runtimeState={status?.state ?? 'idle'} updateBadge={updateBadge} />
      )}
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
          <div ref={splitRef} style={{ display: 'flex', gap: 0, height: '100%' }}>
            {!prefs.focusMode && (
              <>
                <div style={{ flex: `0 0 calc(${prefs.convPct}% - 3px)`, minWidth: 220, overflow: 'auto' }}>
                  <ConversationsPanel tokens={tokens} activeSessionId={activeSessionId} onSelect={setActiveSessionId} />
                </div>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  title="拖拽调整宽度"
                  onPointerDown={(e) => {
                    drag.current = { startX: e.clientX, startPct: prefs.convPct }
                    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
                  }}
                  onPointerMove={(e) => {
                    if (!drag.current || !splitRef.current) return
                    const rect = splitRef.current.getBoundingClientRect()
                    const pct = drag.current.startPct + ((e.clientX - drag.current.startX) / rect.width) * 100
                    setLayout({ convPct: Math.min(CONV_PCT_MAX, Math.max(CONV_PCT_MIN, pct)) })
                  }}
                  onPointerUp={() => {
                    drag.current = null
                  }}
                  style={{
                    flex: '0 0 6px',
                    cursor: 'col-resize',
                    borderRadius: 3,
                    background: colors.border
                  }}
                />
              </>
            )}
            <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
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
