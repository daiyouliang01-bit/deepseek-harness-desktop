import type { Tokens } from '@dshd/ui'
import { useCallback, useEffect, useState } from 'react'
import type { SessionSummary } from '@electron/adapter/session-adapter'
import { messageStore } from '../chat/message-store'

interface ConversationsPanelProps {
  tokens: Tokens
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
}

/**
 * M2 — real conversation list: remote session.list via IPC + local cache,
 * with create / rename / archive / search. Selecting a session loads its
 * history into the message store (events → reducer).
 */
export function ConversationsPanel({
  tokens,
  activeSessionId,
  onSelect
}: ConversationsPanelProps): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ sessionId: string; snippet: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.desktop.sessionList()
      if (res.ok && res.value) setSessions(res.value)
      else setError(res.error ?? 'failed to list sessions')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onCreate = useCallback(async () => {
    const res = await window.desktop.sessionCreate()
    if (res.ok && res.value) {
      onSelect(res.value.sessionId)
      await refresh()
    } else {
      setError(res.error ?? 'create failed')
    }
  }, [onSelect, refresh])

  const onRename = useCallback(
    async (sessionId: string) => {
      const title = window.prompt('Rename session:')
      if (!title) return
      const res = await window.desktop.sessionRename(sessionId, title)
      if (res.ok) await refresh()
      else setError(res.error ?? 'rename failed')
    },
    [refresh]
  )

  const onArchive = useCallback(
    async (sessionId: string) => {
      const res = await window.desktop.sessionArchive(sessionId)
      if (res.ok) await refresh()
      else setError(res.error ?? 'archive failed')
    },
    [refresh]
  )

  const onSearch = useCallback(async (q: string) => {
    setQuery(q)
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    const res = await window.desktop.sessionSearch(q.trim())
    if (res.ok && res.value) setSearchResults(res.value)
  }, [])

  const onLoadHistory = useCallback(
    async (sessionId: string) => {
      onSelect(sessionId)
      const res = await window.desktop.sessionHistory(sessionId)
      if (res.ok && res.value) {
        messageStore.replay(res.value.events)
      } else {
        setError(res.error ?? 'history failed')
      }
    },
    [onSelect]
  )

  const showSearch = query.trim().length > 0
  const visible = showSearch
    ? sessions.filter((s) => searchResults.some((r) => r.sessionId === s.sessionId))
    : sessions

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md }}>
        <h2 style={{ color: colors.text, fontSize: 22, margin: 0 }}>Conversations</h2>
        <button onClick={() => void onCreate()} disabled={busy}>
          + New session
        </button>
      </div>

      <input
        value={query}
        onChange={(e) => void onSearch(e.target.value)}
        placeholder="Search conversations…"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: `${space.sm}px ${space.md}px`,
          marginBottom: space.md,
          background: colors.surfaceAlt,
          color: colors.text,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.sm
        }}
      />

      {error && <p style={{ color: colors.danger, fontSize: font.sizeSm, marginBottom: space.sm }}>⚠ {error}</p>}
      {busy && <p style={{ color: colors.textMuted, fontSize: font.sizeSm }}>Loading…</p>}

      {visible.length === 0 && !busy && (
        <p style={{ color: colors.textMuted, fontSize: 14 }}>
          {showSearch ? 'No matches.' : 'No conversations yet — start a new session.'}
        </p>
      )}

      {visible.map((s) => (
        <div
          key={s.sessionId}
          onClick={() => void onLoadHistory(s.sessionId)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.sm,
            padding: `${space.sm}px ${space.md}px`,
            marginBottom: space.xs,
            background: s.sessionId === activeSessionId ? colors.surfaceAlt : colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            cursor: 'pointer'
          }}
        >
          <div style={{ overflow: 'hidden' }}>
            <div style={{ color: colors.text, fontSize: font.sizeMd, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              {s.title || '(untitled)'}
            </div>
            <div style={{ color: colors.textMuted, fontSize: font.sizeSm, fontFamily: font.mono }}>
              {s.sessionId.slice(0, 8)} · {s.running ? 'running' : 'idle'} ·{' '}
              {new Date(s.updatedAt).toLocaleString()}
            </div>
          </div>
          <div style={{ display: 'flex', gap: space.xs, flexShrink: 0 }}>
            <button
              className="mini"
              onClick={(e) => {
                e.stopPropagation()
                void onRename(s.sessionId)
              }}
            >
              Rename
            </button>
            <button
              className="mini danger"
              onClick={(e) => {
                e.stopPropagation()
                void onArchive(s.sessionId)
              }}
            >
              Archive
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
