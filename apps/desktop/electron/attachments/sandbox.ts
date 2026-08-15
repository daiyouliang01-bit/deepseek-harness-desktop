/** Task 3.5 — attachment parsing sandbox (main process, whitelist + limits). */

import { readFileSync, statSync } from 'node:fs'

export interface AttachmentSpec {
  /** Original file name. */
  name: string
  /** MIME type detected from the extension whitelist. */
  mime: string
  /** Bytes. */
  size: number
  /** Absolute path (main process only; never sent raw to the renderer). */
  path: string
  /** Truncated text preview for safe display (no HTML/JS). */
  preview: string
}

export interface AttachmentOptions {
  maxBytes?: number
  maxPreviewBytes?: number
  /** Allowed MIME types (extension-based whitelist). */
  allowed?: string[]
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024 // 20 MB
const DEFAULT_MAX_PREVIEW = 2_000
const DEFAULT_ALLOWED = [
  'text/plain',
  'text/markdown',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/csv',
  'application/x-yaml'
]

const EXT_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.yml': 'application/x-yaml',
  '.yaml': 'application/x-yaml'
}

export function detectMime(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return EXT_MIME[name.slice(dot).toLowerCase()] ?? null
}

/**
 * Parse an attachment safely: whitelist MIME, size cap, and a plain-text
 * preview with binary/HTML/JS scrubbed. Throws on disallowed types or
 * oversized files — the caller surfaces a recovery message.
 */
export function parseAttachment(path: string, name: string, options: AttachmentOptions = {}): AttachmentSpec {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxPreview = options.maxPreviewBytes ?? DEFAULT_MAX_PREVIEW
  const allowed = options.allowed ?? DEFAULT_ALLOWED

  const mime = detectMime(name)
  if (!mime || !allowed.includes(mime)) {
    throw new Error(`attachment type not allowed: ${name || path} (mime: ${mime ?? 'unknown'})`)
  }

  let size: number
  try {
    size = statSync(path).size
  } catch {
    throw new Error(`attachment unreadable: ${path}`)
  }
  if (size > maxBytes) {
    throw new Error(`attachment too large: ${size} bytes (max ${maxBytes})`)
  }

  const preview = buildPreview(path, mime, maxPreview)
  return { name, mime, size, path, preview }
}

function buildPreview(path: string, mime: string, maxPreview: number): string {
  if (mime.startsWith('image/') || mime === 'application/pdf') {
    return `[${mime}] (binary; preview not rendered in sandbox)`
  }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return '(unreadable)'
  }
  // scrub: plain text only — strip HTML tags and control chars
  text = text.replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  return text.slice(0, maxPreview)
}
