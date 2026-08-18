/**
 * M1 — image intake: header-only preflight (magic bytes + intrinsic size),
 * policy limits, auto-resize (sharp), and base64 encoding for prompt parts.
 *
 * Security: we never full-decode for validation (header parse only), reject
 * non-raster formats (no SVG/HTML), and strip EXIF before sending.
 */

import { readFile } from 'node:fs/promises'

/**
 * Lazy sharp: the native module is only required when images are actually
 * processed. Loading it at module scope makes the whole main process fail on
 * startup when the platform binary is missing from a packaged build, which
 * bricks the app behind an error dialog. With lazy loading the rest of the
 * app still works and image intake degrades gracefully.
 */
let sharpModule: typeof import('sharp')['default'] | null | undefined
function getSharp(): typeof import('sharp')['default'] {
  if (sharpModule === undefined) {
    try {
      const mod = require('sharp') as typeof import('sharp')
      sharpModule = (mod as { default?: typeof import('sharp')['default'] }).default ?? (mod as unknown as typeof import('sharp')['default'])
    } catch {
      sharpModule = null
    }
  }
  if (!sharpModule) throw new Error('sharp unavailable (image intake disabled)')
  return sharpModule
}

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ImageIntakeLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  mediaTypes: readonly ImageMediaType[]
}

export const DEFAULT_IMAGE_LIMITS: ImageIntakeLimits = {
  maxImageBytes: 5 * 1024 * 1024, // 5 MB per image
  maxImagesPerMessage: 10,
  maxMessageImageBytes: 20 * 1024 * 1024, // 20 MB per message
  maxImagePixels: 20_000_000, // ~20 MP
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
}

/** Compression policy: auto-resize when over these thresholds (M1). */
export const AUTO_RESIZE = {
  maxLongEdge: 2048,
  maxBytesAfterResize: 5 * 1024 * 1024
}

export interface PreparedImage {
  name: string
  mediaType: ImageMediaType
  dataB64: string
  width: number
  height: number
  bytes: number
  resized: boolean
}

export type IntakeResult = {
  ok: true
  images: PreparedImage[]
  /** images that failed validation (index → reason) */
  rejected: Array<{ index: number; reason: string }>
  /** total bytes after preparation (for maxMessageImageBytes) */
  totalBytes: number
} | {
  ok: false
  error: string
}

interface RawImage {
  name: string
  mediaType: ImageMediaType
  bytes: Buffer
  width: number
  height: number
}

/** Detect raster format from magic bytes (never trust extension/declaration). */
export function sniffMediaType(buf: Buffer): ImageMediaType | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.length >= 6 && buf.toString('ascii', 0, 6) === 'GIF87a' || buf.length >= 6 && buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif'
  return null
}

/**
 * Preflight a list of image files (paths from the renderer's drop/paste).
 * Returns prepared base64 images ready for session.prompt content parts.
 */
export async function intakeImages(
  paths: Array<{ name: string; path: string }>,
  limits: ImageIntakeLimits = DEFAULT_IMAGE_LIMITS
): Promise<IntakeResult> {
  if (paths.length === 0) return { ok: false, error: 'no images' }
  if (paths.length > limits.maxImagesPerMessage) {
    return { ok: false, error: `too many images: ${paths.length} (max ${limits.maxImagesPerMessage})` }
  }

  const images: PreparedImage[] = []
  const rejected: Array<{ index: number; reason: string }> = []

  for (let i = 0; i < paths.length; i++) {
    const { name, path } = paths[i]
    try {
      const bytes = await readFile(path)
      const mediaType = sniffMediaType(bytes)
      if (!mediaType || !limits.mediaTypes.includes(mediaType)) {
        rejected.push({ index: i, reason: `unsupported format: ${name} (${mediaType ?? 'unknown'})` })
        continue
      }
      if (bytes.length > limits.maxImageBytes) {
        rejected.push({ index: i, reason: `${name} exceeds ${Math.round(limits.maxImageBytes / 1024 / 1024)}MB` })
        continue
      }
      let meta = await getSharp()(bytes, { animated: mediaType === 'image/gif' }).metadata()
      let width = meta.width ?? 0
      let height = meta.height ?? 0
      if (width * height > limits.maxImagePixels) {
        rejected.push({ index: i, reason: `${name} exceeds ${Math.round(limits.maxImagePixels / 1_000_000)}MP` })
        continue
      }

      // auto-resize oversized (long edge > 2048 or > 5MB after encode)
      // and strip EXIF on every path (privacy, P1): sharp re-encodes without
      // metadata unless withMetadata() is requested.
      let outBuf = bytes
      let resized = false
      const longEdge = Math.max(width, height)
      if (longEdge > AUTO_RESIZE.maxLongEdge || bytes.length > AUTO_RESIZE.maxBytesAfterResize) {
        const scale = AUTO_RESIZE.maxLongEdge / longEdge
        const newW = Math.max(1, Math.round(width * scale))
        const newH = Math.max(1, Math.round(height * scale))
        outBuf = await getSharp()(bytes, { animated: mediaType === 'image/gif' })
          .resize(newW, newH, { fit: 'inside' })
          .toBuffer()
        resized = true
        const m2 = await getSharp()(outBuf).metadata()
        width = m2.width ?? newW
        height = m2.height ?? newH
      } else {
        // no resize needed, but still strip EXIF/GPS metadata (privacy)
        outBuf = await getSharp()(bytes, { animated: mediaType === 'image/gif' }).toBuffer()
      }

      images.push({
        name,
        mediaType,
        dataB64: outBuf.toString('base64'),
        width,
        height,
        bytes: outBuf.length,
        resized
      })
    } catch (err) {
      rejected.push({ index: i, reason: `${name}: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  const totalBytes = images.reduce((s, im) => s + im.bytes, 0)
  if (totalBytes > limits.maxMessageImageBytes) {
    return { ok: false, error: `images total ${Math.round(totalBytes / 1024 / 1024)}MB exceeds message limit` }
  }
  return { ok: true, images, rejected, totalBytes }
}
