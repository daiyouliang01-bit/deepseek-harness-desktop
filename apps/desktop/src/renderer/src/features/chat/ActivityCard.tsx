import type { Tokens } from '@dshd/ui'
import { useState } from 'react'
import type { TurnActivity } from './event-reducer'

/**
 * The single "Working · Ns" card shown while the agent works. Raw tool logs
 * are folded into steps; expanding reveals the per-tool detail.
 */
export function ActivityCard({ activity, tokens }: { activity: TurnActivity; tokens: Tokens }): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [open, setOpen] = useState(false)
  const running = activity.steps.some((s) => s.status === 'running')
  const done = activity.steps.filter((s) => s.status === 'done').length
  const elapsed = Math.max(0, Math.round((Date.now() - activity.startedAt) / 1000))
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.lg,
        padding: `${space.md}px`,
        marginBottom: space.md,
        maxWidth: 520
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
        <span style={{ color: running ? colors.warn : colors.success, fontSize: 14 }}>{running ? '◐' : '✓'}</span>
        <span style={{ color: colors.text, fontSize: font.sizeMd, fontWeight: 600 }}>
          {running ? 'Working' : 'Done'} · {elapsed}s
        </span>
        <span style={{ marginLeft: 'auto', color: colors.textMuted, fontSize: font.sizeSm }}>
          {done}/{activity.steps.length}
        </span>
      </div>
      <div style={{ marginTop: space.sm, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {activity.steps.map((step) => (
          <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: space.sm, fontSize: font.sizeMd }}>
            <span style={{ color: step.status === 'failed' ? colors.danger : step.status === 'running' ? colors.warn : colors.success, width: 14 }}>
              {step.status === 'running' ? '●' : step.status === 'failed' ? '✗' : '✓'}
            </span>
            <span style={{ color: colors.textMuted }}>
              {step.label}
              {step.count > 1 ? ` ×${step.count}` : ''}
            </span>
          </div>
        ))}
      </div>
      <button
        className="ghost"
        onClick={() => setOpen(!open)}
        style={{ marginTop: space.sm, fontSize: font.sizeSm, color: colors.textMuted, cursor: 'pointer' }}
      >
        {open ? 'Hide details ▴' : 'Show details ▾'}
      </button>
      {open && (
        <pre
          style={{
            marginTop: space.sm,
            maxHeight: 200,
            overflow: 'auto',
            background: colors.bg,
            borderRadius: radius.sm,
            padding: space.sm,
            fontSize: font.sizeSm,
            fontFamily: font.mono,
            color: colors.textMuted,
            whiteSpace: 'pre-wrap'
          }}
        >
          {activity.steps.map((s) => `${s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : '●'} ${s.label} ×${s.count}`).join('\n')}
        </pre>
      )}
    </div>
  )
}
