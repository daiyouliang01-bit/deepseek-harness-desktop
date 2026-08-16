import type { Tokens } from '@dshd/ui'
import { useCallback, useEffect, useState } from 'react'
import type { AgentEvent } from '@dshd/protocol'
import { messageStore } from './message-store'
import type { ChatMessage, ChatState, ToolCallState } from './event-reducer'

interface ChatViewProps {
  tokens: Tokens
  activeSessionId: string | null
}

function ToolCallRow({ call, tokens }: { call: ToolCallState; tokens: Tokens }): React.JSX.Element {
  const { colors, font, space } = tokens
  const statusColor = call.status === 'ok' ? colors.success : call.status === 'failed' ? colors.danger : colors.warn
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 12,
        color: colors.textMuted,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: `${space.xs}px ${space.sm}px`,
        margin: `${space.xs}px 0`
      }}
    >
      <span style={{ color: statusColor }}>● {call.status}</span> {call.name}
      {call.output !== undefined && <div style={{ color: colors.text }}>{String(call.output).slice(0, 200)}</div>}
    </div>
  )
}

function MessageRow({ msg, tokens }: { msg: ChatMessage; tokens: Tokens }): React.JSX.Element {
  const { colors, space, radius } = tokens
  const align = msg.role === 'user' ? 'flex-end' : 'flex-start'
  const bg = msg.role === 'user' ? colors.surfaceAlt : colors.surface
  return (
    <div style={{ display: 'flex', justifyContent: align, marginBottom: space.md }}>
      <div
        style={{
          maxWidth: '80%',
          background: bg,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.md,
          padding: `${space.sm}px ${space.md}px`,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        {msg.content}
        {msg.streaming && <span style={{ color: colors.textMuted }}>▋</span>}
        {msg.toolCalls.map((tc) => (
          <ToolCallRow key={tc.callId} call={tc} tokens={tokens} />
        ))}
        {msg.errors.map((e, i) => (
          <div key={i} style={{ color: colors.danger, fontSize: 12, marginTop: space.xs }}>
            ⚠ {e.code}: {e.message}
            {e.hint && <div style={{ color: colors.textMuted }}>{e.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * M3 chat view — renders live agent events from the stream bridge (via IPC →
 * messageStore) and sends prompts through the adapter.
 */
export function ChatView({ tokens, activeSessionId }: ChatViewProps): React.JSX.Element {
  const [state, setState] = useState<ChatState>(messageStore.getState())
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streamRunning, setStreamRunning] = useState(false)

  useEffect(() => messageStore.subscribe(setState), [])

  // Live stream: batches of mapped protocol events → reducer.
  useEffect(() => {
    const unsub = window.desktop.onAgentEvent((events: AgentEvent[]) => messageStore.replay(events))
    const unsubState = window.desktop.onAgentStreamState((s) => setStreamRunning(s.running))
    void window.desktop.agentStreamState().then((s) => setStreamRunning(s.running))
    return () => {
      unsub()
      unsubState()
    }
  }, [])

  // Keep the bridge filtered to the active session.
  useEffect(() => {
    void window.desktop.agentSetActiveSession(activeSessionId)
  }, [activeSessionId])

  const onSend = useCallback(async () => {
    const text = input.trim()
    if (!text || !activeSessionId) return
    setInput('')
    setSending(true)
    // optimistic user message, then dispatch real events as they stream in
    messageStore.dispatch({
      type: 'message',
      id: `local:${Date.now()}`,
      role: 'user',
      content: text,
      ts: Date.now()
    })
    try {
      await window.desktop.agentSend(activeSessionId, text)
    } catch (err) {
      messageStore.dispatch({
        type: 'error',
        id: `local-err:${Date.now()}`,
        code: 'unknown',
        message: err instanceof Error ? err.message : String(err),
        retryable: false
      })
    } finally {
      setSending(false)
    }
  }, [input, activeSessionId])

  const onCancel = useCallback(async () => {
    if (!activeSessionId) return
    await window.desktop.agentCancel(activeSessionId)
  }, [activeSessionId])

  const { colors, space, radius, font } = tokens
  const canSend = input.trim().length > 0 && activeSessionId !== null && !sending

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md }}>
        <h2 style={{ color: colors.text, fontSize: 22, margin: 0 }}>Chat</h2>
        <span style={{ color: streamRunning ? colors.success : colors.textMuted, fontSize: font.sizeSm }}>
          {streamRunning ? '● live stream' : '○ stream offline'}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', paddingBottom: space.md }}>
        {state.messages.length === 0 && (
          <p style={{ color: colors.textMuted, fontSize: 14 }}>
            {activeSessionId ? 'Select a session and send a message.' : 'Create or select a conversation to start.'}
          </p>
        )}
        {state.messages.map((m) => (
          <MessageRow key={m.id + m.ts} msg={m} tokens={tokens} />
        ))}
        {state.approvals.length > 0 && (
          <div style={{ color: colors.warn, fontSize: 13, marginTop: space.md }}>
            ⏳ {state.approvals.length} approval(s) pending
          </div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: space.md }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void onSend()
            }
          }}
          placeholder={activeSessionId ? 'Message (Enter to send, Shift+Enter for newline)…' : 'Select a conversation first'}
          rows={3}
          disabled={activeSessionId === null}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            background: colors.surfaceAlt,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            padding: `${space.sm}px ${space.md}px`,
            fontFamily: 'inherit',
            fontSize: font.sizeMd
          }}
        />
        <div style={{ display: 'flex', gap: space.sm, marginTop: space.sm }}>
          <button onClick={() => void onSend()} disabled={!canSend}>
            {sending ? 'Sending…' : 'Send'}
          </button>
          {streamRunning && (
            <button className="ghost" onClick={() => void onCancel()}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
