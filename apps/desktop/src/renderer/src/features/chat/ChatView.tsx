import type { Tokens } from '@dshd/ui'
import { useEffect, useState } from 'react'
import { messageStore } from './message-store'
import type { ChatState, ChatMessage, ToolCallState } from './event-reducer'

interface ChatViewProps {
  tokens: Tokens
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
 * Task 3.2 chat view — renders normalized agent events. Reads from the
 * MessageStore; a live protocol stream (Phase 2.1+ adapter) will dispatch
 * events into the store.
 */
export function ChatView({ tokens }: ChatViewProps): React.JSX.Element {
  const [state, setState] = useState<ChatState>(messageStore.getState())

  useEffect(() => messageStore.subscribe(setState), [])

  const { colors, space } = tokens
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ color: colors.text, fontSize: 22, marginBottom: space.md }}>Chat</h2>
      {state.messages.length === 0 && (
        <p style={{ color: colors.textMuted, fontSize: 14 }}>
          No messages yet. The protocol stream (Task 2.1) will feed events here.
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
  )
}
