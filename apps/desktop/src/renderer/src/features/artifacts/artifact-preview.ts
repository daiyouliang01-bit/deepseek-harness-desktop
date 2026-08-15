/** Task 4.2 — artifact preview whitelist (no arbitrary HTML/JS execution). */

export type ArtifactKind = 'image' | 'text' | 'markdown' | 'json' | 'csv' | 'blocked'

export interface ArtifactPreview {
  kind: ArtifactKind
  /** safe content for rendering; markdown is rendered with scripting stripped */
  content?: string
  /** reason when kind === 'blocked' */
  reason?: string
}

const TEXT_KINDS = new Set(['text', 'markdown', 'json', 'csv'])

/**
 * Classify an artifact for preview. Only whitelisted kinds render; anything
 * executable (html/svg/js) is BLOCKED — never rendered as live markup.
 * Executable extensions are checked FIRST so svg-with-image-mime still blocks.
 */
export function classifyArtifact(name: string, mime: string): ArtifactKind {
  if (/\.(html?|svg|js|mjs|wasm)$/i.test(name)) return 'blocked'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'text/markdown' || /\.md$/i.test(name)) return 'markdown'
  if (mime === 'application/json' || /\.json$/i.test(name)) return 'json'
  if (mime === 'text/csv' || /\.csv$/i.test(name)) return 'csv'
  if (mime === 'text/plain' || mime.startsWith('text/')) return 'text'
  return 'blocked'
}

/**
 * Build a preview payload. HTML/SVG/JS artifacts are refused outright; other
 * kinds get plain text (markdown/json/csv rendered as text by the UI).
 */
export function buildArtifactPreview(name: string, mime: string, content: string, maxBytes = 100_000): ArtifactPreview {
  const kind = classifyArtifact(name, mime)
  if (kind === 'blocked') {
    return { kind, reason: `preview blocked for ${name} (${mime || 'unknown'}) — no HTML/JS execution` }
  }
  if (content.length > maxBytes) {
    return { kind, content: content.slice(0, maxBytes) + '\n… (truncated)' }
  }
  return { kind, content }
}

export { TEXT_KINDS }
