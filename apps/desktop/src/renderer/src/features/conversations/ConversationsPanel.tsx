import type { Tokens } from '@dshd/ui'

interface ConversationsPanelProps {
  tokens: Tokens
}

/**
 * Task 3.1 placeholder. Real conversation list arrives with persistence
 * (Task 3.3) and the chat UI (Task 3.2/3.4).
 */
export function ConversationsPanel({ tokens }: ConversationsPanelProps): React.JSX.Element {
  const { colors, space, radius } = tokens
  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ color: colors.text, fontSize: 22, marginBottom: space.md }}>Conversations</h2>
      <div
        style={{
          background: colors.surface,
          borderRadius: radius.md,
          padding: space.lg,
          color: colors.textMuted,
          fontSize: 14
        }}
      >
        No conversations yet. Chat history arrives with local persistence (Task 3.3).
      </div>
    </div>
  )
}
