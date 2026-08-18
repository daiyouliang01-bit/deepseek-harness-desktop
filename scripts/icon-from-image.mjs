/**
 * Generate the app icon from the upper half of a source image.
 *
 * Usage: node scripts/icon-from-image.mjs <source-image> [out-dir]
 *
 * Crops the top ~58% (head/shoulders), centers it on a square canvas with the
 * dominant background color, resizes to 512px, and regenerates the iconset +
 * .icns (macOS) via sips/iconutil.
 */
import sharp from 'sharp'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.argv[2]
const OUT = process.argv[3] ? join(process.cwd(), process.argv[3]) : join(ROOT, 'apps/desktop/build')

if (!SRC || !existsSync(SRC)) {
  console.error('usage: node scripts/icon-from-image.mjs <source-image> [out-dir]')
  process.exit(1)
}

const CROP_RATIO = 0.58 // top 58% = head + shoulders
const SIZE = 1024

async function main() {
  const meta = await sharp(SRC).metadata()
  const w = meta.width ?? 1
  const h = meta.height ?? 1
  const cropH = Math.round(h * CROP_RATIO)
  console.log(`[icon] source ${w}x${h}, cropping top ${cropH}px (head/shoulders)`)

  // dominant background color: sample the top-left corner
  const corner = await sharp(SRC).extract({ left: 0, top: 0, width: 4, height: 4 }).raw().toBuffer()
  const bg = { r: corner[0], g: corner[1], b: corner[2] }
  console.log(`[icon] background sampled: rgb(${bg.r},${bg.g},${bg.b})`)

  // crop the upper part, then center it on a square canvas with that bg
  const cropped = await sharp(SRC)
    .extract({ left: 0, top: 0, width: w, height: cropH })
    .resize(Math.round(SIZE * 0.86), Math.round((SIZE * 0.86) * (cropH / w)), { fit: 'inside', withoutEnlargement: false })
    .toBuffer()

  const composed = await sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: bg }
  })
    .composite([{ input: cropped, gravity: 'centre' }])
    .png()
    .toBuffer()

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'icon.png'), composed)
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
    const buf = await sharp(composed).resize(s, s).png().toBuffer()
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
