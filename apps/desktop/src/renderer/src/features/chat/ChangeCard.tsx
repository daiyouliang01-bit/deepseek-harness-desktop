import type { Tokens } from '@dshd/ui'
import { useState } from 'react'
import type { ChangeSummary } from './event-reducer'

const KIND_MARK: Record<ChangeSummary['kind'], string> = {
  write: 'A',
  edit: 'M',
  str_replace_editor: 'M',
}

/**
 * Change card: the files the agent modified this turn (no line stats by
 * design — file names only). Expanding reveals the full path list.
 */
export function ChangeCard({ changes, tokens }: { changes: ChangeSummary[]; tokens: Tokens }): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [open, setOpen] = useState(false)
  const paths = changes.map((c) => c.path).filter(Boolean)
  const unique = [...new Set(paths)]
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
        <span style={{ color: colors.success, fontSize: 14 }}>✓</span>
        <span style={{ color: colors.text, fontSize: font.sizeMd, fontWeight: 600 }}>
          Changes · {unique.length} {unique.length > 1 ? 'files' : 'file'}
        </span>
        <button
          className="ghost"
          onClick={() => setOpen(!open)}
          style={{ marginLeft: 'auto', fontSize: font.sizeSm, color: colors.textMuted, cursor: 'pointer' }}
        >
          {open ? 'Hide details ▴' : 'View details ▾'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: space.sm, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {unique.map((p) => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: space.sm, fontSize: font.sizeMd, fontFamily: font.mono }}>
              <span style={{ color: colors.success, width: 14, flexShrink: 0 }}>{KIND_MARK[changes.find((c) => c.path === p)?.kind ?? 'edit']}</span>
              <span style={{ color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
