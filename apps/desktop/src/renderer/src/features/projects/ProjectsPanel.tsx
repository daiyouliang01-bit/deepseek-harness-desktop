import type { Tokens } from '@dshd/ui'

interface ProjectsPanelProps {
  tokens: Tokens
}

/**
 * Task 3.1 placeholder. Workspace-scoped projects land in Phase 4 (Task 4.2).
 */
export function ProjectsPanel({ tokens }: ProjectsPanelProps): React.JSX.Element {
  const { colors, space, radius } = tokens
  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ color: colors.text, fontSize: 22, marginBottom: space.md }}>Projects</h2>
      <div
        style={{
          background: colors.surface,
          borderRadius: radius.md,
          padding: space.lg,
          color: colors.textMuted,
          fontSize: 14
        }}
      >
        Workspace-scoped projects, files, terminal and artifacts arrive in Phase 4 (Task 4.2).
      </div>
    </div>
  )
}
