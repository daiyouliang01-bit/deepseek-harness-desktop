import type { Tokens } from '@dshd/ui'
import { useCallback, useEffect, useState } from 'react'
import type { AgentEvent } from '@dshd/protocol'
import { messageStore } from './message-store'
import type { ChatMessage, ChatState, ToolCallState } from './event-reducer'
import { ImageAttachments, type PendingImage } from './ImageAttachments'

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

function ApprovalCard({
  approval,
  sessionId,
  tokens
}: {
  approval: { id: string; permission: string; scope?: unknown }
  sessionId: string
  tokens: Tokens
}): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [busy, setBusy] = useState(false)
  const decide = async (outcome: 'allowed-once' | 'rejected'): Promise<void> => {
    setBusy(true)
    const res = await window.desktop.agentApprove(sessionId, approval.id, outcome)
    setBusy(false)
    if (res.ok) {
      messageStore.dispatch({ type: 'approval-resolved', id: approval.id, outcome })
    }
  }
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.warn}`,
        borderRadius: radius.md,
        padding: `${space.sm}px ${space.md}px`,
        marginBottom: space.md
      }}
    >
      <div style={{ color: colors.warn, fontSize: font.sizeSm, marginBottom: space.xs }}>⚠ Approval requested</div>
      <div style={{ color: colors.text, fontFamily: font.mono, fontSize: font.sizeSm, marginBottom: space.sm }}>
        {approval.permission}
      </div>
      <div style={{ display: 'flex', gap: space.sm }}>
        <button onClick={() => void decide('allowed-once')} disabled={busy}>
          Allow once
        </button>
        <button className="ghost" onClick={() => void decide('rejected')} disabled={busy}>
          Reject
        </button>
      </div>
    </div>
  )
}

function QuestionCard({
  question,
  sessionId,
  tokens
}: {
  question: { id: string; question: string; options?: Array<{ label: string; value: unknown }>; multiSelect?: boolean }
  sessionId: string
  tokens: Tokens
}): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const answer = async (): Promise<void> => {
    setBusy(true)
    const res = await window.desktop.agentAnswer(sessionId, question.id, selected)
    setBusy(false)
    if (res.ok) {
      messageStore.dispatch({ type: 'question-resolved', id: question.id, outcome: 'answered' })
    }
  }
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.accent}`,
        borderRadius: radius.md,
        padding: `${space.sm}px ${space.md}px`,
        marginBottom: space.md
      }}
    >
      <div style={{ color: colors.accent, fontSize: font.sizeSm, marginBottom: space.xs }}>❓ Question</div>
      <div style={{ color: colors.text, marginBottom: space.sm }}>{question.question}</div>
      {question.options?.map((opt) => {
        const on = selected.includes(opt.label)
        return (
          <label
            key={opt.label}
            style={{ display: 'block', color: colors.textMuted, fontSize: font.sizeSm, marginBottom: space.xs, cursor: 'pointer' }}
          >
            <input
              type={question.multiSelect ? 'checkbox' : 'radio'}
              name={question.id}
              checked={on}
              onChange={() => {
                if (question.multiSelect) {
                  setSelected(on ? selected.filter((s) => s !== opt.label) : [...selected, opt.label])
                } else {
                  setSelected([opt.label])
                }
              }}
            />{' '}
            {opt.label}
          </label>
        )
      })}
      <button onClick={() => void answer()} disabled={busy || selected.length === 0} style={{ marginTop: space.sm }}>
        {busy ? 'Sending…' : 'Answer'}
      </button>
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
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])

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
    const hasImages = pendingImages.length > 0
    if ((!text && !hasImages) || !activeSessionId) return
    setInput('')
    setSending(true)
    const images = pendingImages
    setPendingImages([])
    // optimistic user message (text + image count), then real events stream in
    messageStore.dispatch({
      type: 'message',
      id: `local:${Date.now()}`,
      role: 'user',
      content: text + (images.length > 0 ? `\n\n[📷 ${images.length} 张图片]` : ''),
      ts: Date.now()
    })
    try {
      const res = await window.desktop.agentSend(
        activeSessionId,
        text,
        images.map((im) => ({ name: im.name, path: im.path }))
      )
      if (!res.ok) {
        messageStore.dispatch({
          type: 'error',
          id: `local-err:${Date.now()}`,
          code: 'unknown',
          message: res.error ?? 'send failed',
          retryable: false
        })
      } else if (res.value?.rejected?.length) {
        messageStore.dispatch({
          type: 'error',
          id: `local-err:${Date.now()}`,
          code: 'unknown',
          message: `部分图片被拒绝: ${res.value.rejected.map((r) => r.reason).join('; ')}`,
          retryable: false
        })
      }
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
  }, [input, activeSessionId, pendingImages])

  const onCancel = useCallback(async () => {
    if (!activeSessionId) return
    await window.desktop.agentCancel(activeSessionId)
  }, [activeSessionId])

  const { colors, space, radius, font } = tokens
  const canSend = (input.trim().length > 0 || pendingImages.length > 0) && activeSessionId !== null && !sending

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
        {state.approvals.map((a) => (
          <ApprovalCard
            key={a.id}
            approval={a}
            sessionId={activeSessionId ?? ''}
            tokens={tokens}
          />
        ))}
        {state.questions.map((q) => (
          <QuestionCard key={q.id} question={q} sessionId={activeSessionId ?? ''} tokens={tokens} />
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: space.md }}>
        <ImageAttachments
          tokens={tokens}
          images={pendingImages}
          onAdd={(imgs) => setPendingImages((prev) => [...prev, ...imgs])}
          onRemove={(id) => setPendingImages((prev) => prev.filter((im) => im.id !== id))}
          onClear={() => setPendingImages([])}
          disabled={activeSessionId === null || sending}
        />
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
            {sending ? 'Sending…' : pendingImages.length > 0 ? `Send (文 + ${pendingImages.length} 图)` : 'Send'}
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
