import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { intakeImages, sniffMediaType, type ImageIntakeLimits } from './image-intake'

// minimal valid PNG (1x1 red), JPEG (1x1), WEBP (1x1)
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

describe('sniffMediaType', () => {
  it('detects png/gif from magic bytes, rejects svg/html/text', () => {
    expect(sniffMediaType(PNG_1x1)).toBe('image/png')
    expect(sniffMediaType(GIF_1x1)).toBe('image/gif')
    expect(sniffMediaType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(sniffMediaType(Buffer.from('<!DOCTYPE html><html></html>'))).toBeNull()
    expect(sniffMediaType(Buffer.from('plain text content'))).toBeNull()
    expect(sniffMediaType(Buffer.alloc(0))).toBeNull()
  })
})

describe('intakeImages', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-intake-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a valid png and returns base64 + dimensions', async () => {
    const p = join(dir, 'a.png')
    writeFileSync(p, PNG_1x1)
    const res = await intakeImages([{ name: 'a.png', path: p }])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.images).toHaveLength(1)
      expect(res.images[0].mediaType).toBe('image/png')
      expect(res.images[0].dataB64.length).toBeGreaterThan(0)
      expect(res.rejected).toHaveLength(0)
    }
  })

  it('rejects non-raster files (svg) with a reason', async () => {
    const p = join(dir, 'evil.svg')
    writeFileSync(p, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const res = await intakeImages([{ name: 'evil.svg', path: p }])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.images).toHaveLength(0)
      expect(res.rejected[0].reason).toMatch(/unsupported format/)
    }
  })

  it('enforces maxImagesPerMessage and per-image byte limits', async () => {
    const p = join(dir, 'a.png')
    writeFileSync(p, PNG_1x1)
    const limits: ImageIntakeLimits = {
      maxImageBytes: 10, // tiny
      maxImagesPerMessage: 1,
      maxMessageImageBytes: 1_000_000,
      maxImagePixels: 1_000_000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    }
    const res = await intakeImages([{ name: 'a.png', path: p }], limits)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.rejected[0].reason).toMatch(/exceeds/)

    const res2 = await intakeImages([{ name: 'a.png', path: p }, { name: 'b.png', path: p }], {
      ...limits,
      maxImageBytes: 1_000_000
    })
    expect(res2.ok).toBe(false)
    if (!res2.ok) expect(res2.error).toMatch(/too many images/)
  })

  it('auto-resizes oversized images (long edge > 2048)', async () => {
    // build a 3000x3000 png via sharp
    const sharp = (await import('sharp')).default
    const big = await sharp({ create: { width: 3000, height: 3000, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } })
      .png()
      .toBuffer()
    const p = join(dir, 'big.png')
    writeFileSync(p, big)
    const res = await intakeImages([{ name: 'big.png', path: p }])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.images[0].resized).toBe(true)
      expect(Math.max(res.images[0].width, res.images[0].height)).toBeLessThanOrEqual(2048)
    }
  })

  it('partial success: valid + invalid images → images + rejected indexes', async () => {
    const good = join(dir, 'good.png')
    const bad = join(dir, 'bad.svg')
    writeFileSync(good, PNG_1x1)
    writeFileSync(bad, '<svg></svg>')
    const res = await intakeImages([
      { name: 'good.png', path: good },
      { name: 'bad.svg', path: bad }
    ])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.images).toHaveLength(1)
      expect(res.rejected).toHaveLength(1)
      expect(res.rejected[0].index).toBe(1)
    }
  })

  it('enforces maxMessageImageBytes across the batch', async () => {
    const p = join(dir, 'a.png')
    writeFileSync(p, PNG_1x1)
    const limits: ImageIntakeLimits = {
      maxImageBytes: 1_000_000,
      maxImagesPerMessage: 10,
      maxMessageImageBytes: 1, // 1 byte total
      maxImagePixels: 1_000_000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    }
    const res = await intakeImages([{ name: 'a.png', path: p }], limits)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/message limit/)
  })

  it('strips EXIF metadata on the non-resize path (privacy)', async () => {
    const sharp = (await import('sharp')).default
    // build a small jpeg WITH exif (GPS-ish tag)
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 200, b: 30 } } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'Secret GPS location' } } })
      .toBuffer()
    const p = join(dir, 'with-exif.jpg')
    writeFileSync(p, jpeg)
    const res = await intakeImages([{ name: 'with-exif.jpg', path: p }])
    expect(res.ok).toBe(true)
    if (res.ok) {
      const outMeta = await sharp(Buffer.from(res.images[0].dataB64, 'base64')).metadata()
      // sharp metadata exposes exif only when present
      expect(outMeta.exif).toBeUndefined()
    }
  })
})
