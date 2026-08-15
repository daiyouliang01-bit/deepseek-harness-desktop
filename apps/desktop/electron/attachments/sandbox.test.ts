/** Task 3.5 — attachment sandbox tests. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectMime, parseAttachment } from './sandbox'

describe('attachment sandbox', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-attach-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('detects MIME from extension', () => {
    expect(detectMime('notes.txt')).toBe('text/plain')
    expect(detectMime('photo.JPG')).toBe('image/jpeg')
    expect(detectMime('noext')).toBeNull()
    expect(detectMime('evil.exe')).toBeNull()
  })

  it('parses an allowed text file with scrubbed preview', () => {
    const p = join(dir, 'notes.md')
    writeFileSync(p, '# Title\n\n<script>alert(1)</script>\nplain text\n')
    const spec = parseAttachment(p, 'notes.md')
    expect(spec.mime).toBe('text/markdown')
    expect(spec.preview).not.toContain('<script>')
    expect(spec.preview).toContain('plain text')
    expect(spec.preview).toContain('Title')
  })

  it('rejects disallowed types (executables)', () => {
    const p = join(dir, 'evil.exe')
    writeFileSync(p, 'MZ...')
    expect(() => parseAttachment(p, 'evil.exe')).toThrow(/not allowed/)
  })

  it('rejects oversized files', () => {
    const p = join(dir, 'big.txt')
    writeFileSync(p, 'x'.repeat(1_000))
    expect(() => parseAttachment(p, 'big.txt', { maxBytes: 100 })).toThrow(/too large/)
  })

  it('image/pdf previews are marked binary and not read', () => {
    const p = join(dir, 'img.png')
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const spec = parseAttachment(p, 'img.png')
    expect(spec.mime).toBe('image/png')
    expect(spec.preview).toMatch(/\[image\/png\]/)
  })

  it('throws on unreadable files', () => {
    expect(() => parseAttachment(join(dir, 'missing.txt'), 'missing.txt')).toThrow(/unreadable/)
  })
})
