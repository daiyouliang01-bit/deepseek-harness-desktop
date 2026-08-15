/** Task 4.2 — diff review (pure model for the UI). */

export type DiffLineKind = 'context' | 'add' | 'remove'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  oldLine?: number
  newLine?: number
}

export interface FileDiff {
  path: string
  lines: DiffLine[]
  additions: number
  deletions: number
}

/** Parse a unified diff (or a simple before/after) into reviewable lines. */
export function parseUnifiedDiff(diffText: string, path = 'unknown'): FileDiff {
  const lines: DiffLine[] = []
  let additions = 0
  let deletions = 0
  let oldLine = 0
  let newLine = 0

  for (const raw of diffText.split(/\r?\n/)) {
    const line = raw
    // skip file headers and metadata lines
    if (/^(---|\+\+\+|diff --git|index |new file|deleted file|similarity)/.test(line)) {
      lines.push({ kind: 'context', text: line })
      continue
    }
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (m) {
        oldLine = Number(m[1]) - 1
        newLine = Number(m[2]) - 1
      }
      lines.push({ kind: 'context', text: line })
      continue
    }
    if (line.startsWith('+')) {
      additions++
      newLine++
      lines.push({ kind: 'add', text: line.slice(1), newLine })
      continue
    }
    if (line.startsWith('-')) {
      deletions++
      oldLine++
      lines.push({ kind: 'remove', text: line.slice(1), oldLine })
      continue
    }
    oldLine++
    newLine++
    lines.push({ kind: 'context', text: line, oldLine, newLine })
  }
  return { path, lines, additions, deletions }
}

/** Simple before/after diff when no unified text is available. */
export function simpleDiff(before: string, after: string, path = 'unknown'): FileDiff {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const lines: DiffLine[] = []
  const max = Math.max(beforeLines.length, afterLines.length)
  let additions = 0
  let deletions = 0
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i]
    const a = afterLines[i]
    if (b !== undefined && a === undefined) {
      deletions++
      lines.push({ kind: 'remove', text: b, oldLine: i + 1 })
    } else if (a !== undefined && b === undefined) {
      additions++
      lines.push({ kind: 'add', text: a, newLine: i + 1 })
    } else if (a !== b) {
      deletions++
      additions++
      lines.push({ kind: 'remove', text: b ?? '', oldLine: i + 1 })
      lines.push({ kind: 'add', text: a ?? '', newLine: i + 1 })
    } else {
      lines.push({ kind: 'context', text: a ?? '', oldLine: i + 1, newLine: i + 1 })
    }
  }
  return { path, lines, additions, deletions }
}
