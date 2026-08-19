import type { Tokens } from '@dshd/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionSummary } from '@electron/adapter/session-adapter'
import { messageStore } from '../chat/message-store'

interface ConversationListProps {
  tokens: Tokens
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
}

/** Group label for a timestamp (今天 / 昨天 / 前 7 天 / year). */
export function groupOf(ts: number, now: number): string {
  const day = 86_400_000
  const today = new Date(now).setHours(0, 0, 0, 0)
  const that = new Date(ts).setHours(0, 0, 0, 0)
  if (that === today) return '今天'
  if (that === today - day) return '昨天'
  if (that >= today - 7 * day) return '前 7 天'
  return new Date(ts).getFullYear().toString()
}

/** Claude-style relative time. */
export function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86_400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 86_400 * 7) return `${Math.floor(s / 86_400)} 天前`
  return new Date(ts).toLocaleDateString()
}

/** Local auto title: official title, else search marker, else first-message
 *  truncation stored in the message store (never written to the official
 *  session.rename — zero official-surface changes). */
export function autoTitle(s: SessionSummary, query: string, firstMessage: string | undefined): string {
  if (s.title && s.title.trim()) return s.title
  if (query.trim()) return `搜索: ${query}`
  if (firstMessage && firstMessage.trim()) {
    const cut = firstMessage.trim().slice(0, 40)
    return cut.length < firstMessage.trim().length ? `${cut}…` : cut
  }
  return `新会话 ${s.sessionId.slice(0, 8)}`
}

const GROUPS = ['今天', '昨天', '前 7 天'] as const

function groupKey(label: string): number {
  const idx = GROUPS.indexOf(label as (typeof GROUPS)[number])
  return idx >= 0 ? idx : 10
}

/**
 * Claude-style persistent conversation list column: grouped by recency,
 * hover actions (rename / archive), right-click menu, auto titles, search.
 */
export function ConversationList({ tokens, activeSessionId, onSelect }: ConversationListProps): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ sessionId: string; snippet: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null)
  const [firstMessages, setFirstMessages] = useState<Record<string, string>>({})

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

  // The runtime may not be ready on first mount (e.g. force-shell startup):
  // re-list once the runtime reports ready instead of leaving a stale error.
  useEffect(() => {
    return window.desktop.onRuntimeStatus((status) => {
      if (status.state === 'ready') void refresh()
    })
  }, [refresh])

  // Track the first user message per session for auto titles (local only).
  useEffect(() => {
    return messageStore.subscribe((state) => {
      const first = state.messages.find((m) => m.role === 'user')
      if (!first) return
      const sid = activeSessionId
      if (!sid) return
      setFirstMessages((prev) => (prev[sid] ? prev : { ...prev, [sid]: first.content }))
    })
  }, [activeSessionId])

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
      const title = window.prompt('重命名会话:')
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

  const onSearch = useCallback(
    async (q: string) => {
      setQuery(q)
      if (!q.trim()) {
        setSearchResults([])
        return
      }
      const res = await window.desktop.sessionSearch(q.trim())
      if (res.ok && res.value) setSearchResults(res.value)
    },
    []
  )

  const onLoadHistory = useCallback(
    async (sessionId: string) => {
      onSelect(sessionId)
      setMenu(null)
      const res = await window.desktop.sessionHistory(sessionId)
      if (res.ok && res.value) {
        messageStore.replay(res.value.events)
      } else {
        setError(res.error ?? 'history failed')
      }
    },
    [onSelect]
  )

  const copyId = useCallback((sessionId: string) => {
    void navigator.clipboard?.writeText(sessionId)
    setMenu(null)
  }, [])

  const showSearch = query.trim().length > 0
  const visible = showSearch
    ? sessions.filter((s) => searchResults.some((r) => r.sessionId === s.sessionId))
    : sessions

  const grouped = useMemo(() => {
    const now = Date.now()
    const map = new Map<string, SessionSummary[]>()
    for (const s of visible) {
      const key = groupOf(s.updatedAt, now)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return [...map.entries()].sort((a, b) => groupKey(a[0]) - groupKey(b[0]))
  }, [visible])

  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        background: colors.bg,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <div style={{ padding: space.md, display: 'flex', flexDirection: 'column', gap: space.sm }}>
        <button
          onClick={() => void onCreate()}
          disabled={busy}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.sm,
            width: '100%',
            padding: `${space.sm}px ${space.md}px`,
            borderRadius: radius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            fontSize: font.sizeMd,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          + New chat
        </button>
        <input
          value={query}
          onChange={(e) => void onSearch(e.target.value)}
          placeholder="搜索会话…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: `${space.sm}px ${space.md}px`,
            borderRadius: radius.md,
            background: colors.surface,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            fontSize: font.sizeMd
          }}
        />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: `0 ${space.sm}px ${space.md}px` }}>
        {error && (
          <div style={{ padding: `0 ${space.xs}px`, marginBottom: space.sm }}>
            <p style={{ color: colors.danger, fontSize: font.sizeSm, margin: `0 0 ${space.xs}px` }}>
              ⚠ {error}
            </p>
            <button className="mini" onClick={() => void refresh()}>
              重试
            </button>
          </div>
        )}

        {visible.length === 0 && !busy && (
          <p style={{ color: colors.textMuted, fontSize: 13, padding: `0 ${space.xs}px`, textAlign: 'center', marginTop: space.lg }}>
            {showSearch ? '没有匹配的会话' : '还没有会话 — 新建一个开始。'}
          </p>
        )}

        {grouped.map(([label, items]) => (
          <div key={label} style={{ marginBottom: space.sm }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: colors.textMuted,
                padding: `${space.xs}px ${space.sm}px`
              }}
            >
              {label}
            </div>
            {items.map((s) => {
              const active = s.sessionId === activeSessionId
              const isHovered = hovered === s.sessionId
              const title = autoTitle(s, query, firstMessages[s.sessionId])
              return (
                <div
                  key={s.sessionId}
                  onClick={() => void onLoadHistory(s.sessionId)}
                  onMouseEnter={() => setHovered(s.sessionId)}
                  onMouseLeave={() => setHovered(null)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ sessionId: s.sessionId, x: e.clientX, y: e.clientY })
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: space.xs,
                    padding: `${space.sm}px ${space.md}px`,
                    borderRadius: radius.md,
                    cursor: 'pointer',
                    background: active ? colors.surfaceAlt : 'transparent',
                    marginBottom: 1
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 99,
                      flexShrink: 0,
                      background: s.running ? colors.success : 'transparent'
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <div
                      style={{
                        color: active ? colors.text : colors.textMuted,
                        fontSize: font.sizeMd,
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden'
                      }}
                    >
                      {title}
                    </div>
                    <div style={{ color: colors.textMuted, fontSize: font.sizeSm, opacity: 0.7 }}>
                      {relativeTime(s.updatedAt, Date.now())}
                    </div>
                  </div>
                  {isHovered && (
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <button
                        className="mini"
                        title="重命名"
                        onClick={(e) => {
                          e.stopPropagation()
                          void onRename(s.sessionId)
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="mini"
                        title="归档"
                        onClick={(e) => {
                          e.stopPropagation()
                          void onArchive(s.sessionId)
                        }}
                      >
                        🗂
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: `${space.sm}px ${space.md}px`, borderTop: `1px solid ${colors.border}` }}>
        <div style={{ fontSize: font.sizeSm, color: colors.textMuted, display: 'flex', justifyContent: 'space-between' }}>
          <span>Skills</span>
          <span>Settings</span>
        </div>
      </div>

      {menu && (
        <div
          style={{
            position: 'fixed',
            top: menu.y,
            left: menu.x,
            zIndex: 100,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            minWidth: 160,
            padding: 4
          }}
          onMouseLeave={() => setMenu(null)}
        >
          <button
            className="menu-item"
            onClick={() => {
              void onRename(menu.sessionId)
              setMenu(null)
            }}
          >
            重命名
          </button>
          <button
            className="menu-item"
            onClick={() => {
              void onArchive(menu.sessionId)
              setMenu(null)
            }}
          >
            归档
          </button>
          <button
            className="menu-item"
            onClick={() => copyId(menu.sessionId)}
          >
            复制 sessionId
          </button>
        </div>
      )}
    </div>
  )
}
