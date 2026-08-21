/**
 * Generate the app icon from the upper part of a source image.
 *
 * Usage: node scripts/icon-from-image.mjs [source-image] [out-dir]
 *
 * Crops a top square so the artwork reaches every edge of the icon canvas,
 * resizes it to 1024px, and regenerates the iconset + .icns (macOS).
 */
import sharp from 'sharp'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SRC = join(ROOT, 'scripts/assets/app-icon-source.png')
const SRC = process.argv[2] ?? DEFAULT_SRC
const OUT = process.argv[3] ? resolve(process.argv[3]) : join(ROOT, 'apps/desktop/build')

if (!existsSync(SRC)) {
  console.error('usage: node scripts/icon-from-image.mjs [source-image] [out-dir]')
  process.exit(1)
}

const SIZE = 1024

async function main() {
  const meta = await sharp(SRC).metadata()
  const w = meta.width ?? 1
  const h = meta.height ?? 1
  const cropSize = Math.min(w, h)
  const left = Math.max(0, Math.floor((w - cropSize) / 2))
  console.log(`[icon] source ${w}x${h}, cropping top square ${cropSize}x${cropSize}`)

  // Crop to a square at the top of the image, then resize directly to the
  // icon canvas. There is intentionally no inset/composite step: the source
  // artwork must reach the canvas edges instead of acquiring a safety border.
  const cropped = await sharp(SRC)
    .extract({ left, top: 0, width: cropSize, height: cropSize })
    .resize(SIZE, SIZE, { fit: 'fill' })
    .png()
    .toBuffer()

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'icon.png'), cropped)
  console.log('[icon] wrote icon.png (1024)')

  // iconset + icns
  const iconset = join(OUT, 'icon.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ]
  for (const [s, name] of sizes) {
    const buf = await sharp(cropped).resize(s, s).png().toBuffer()
    writeFileSync(join(iconset, name), buf)
  }
  try {
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(OUT, 'icon.icns')])
    console.log('[icon] wrote icon.icns')
  } catch {
    console.warn('[icon] iconutil failed; icon.png kept')
  }
}

main().catch((err) => {
  console.error('[icon] failed:', err)
  process.exit(1)
})
