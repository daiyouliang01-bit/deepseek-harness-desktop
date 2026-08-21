/**
 * Generate the DeepSeek Harness Desktop app icon (512×512 PNG + .icns + .ico).
 *
 * Pure-Node PNG writer (zlib) — no image dependencies. Draws a rounded
 * gradient square with a white chat-bubble glyph, matching the tray icon's
 * blue-purple palette.
 *
 * Usage: node scripts/generate-icon.mjs [out-dir]
 * Outputs: build/icon.png (512), build/icon.iconset/*.png, build/icon.icns,
 *          build/icon.ico (256×256, PNG-compressed ICO for Windows)
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, 'apps/desktop/build')

// ── minimal PNG writer ──
function crc32(buf) {
  let t = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
function png(w, h, pixelAt) {
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0 // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixelAt(x, y)
      const i = y * (1 + w * 4) + 1 + x * 4
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ── drawing ──
const SIZE = 512
function render(size) {
  const scale = size / SIZE
  const inRounded = (px, py, x, y, w, h, r) => {
    const dx = Math.max(x + r - px, 0, px - (x + w - r))
    const dy = Math.max(y + r - py, 0, py - (y + h - r))
    return dx * dx + dy * dy <= r * r
  }
  const inBubble = (px, py) => {
    // main bubble rect (slightly rounded)
    const bx = 96 * scale, by = 120 * scale, bw = 320 * scale, bh = 220 * scale, br = 48 * scale
    if (inRounded(px, py, bx, by, bw, bh, br)) return true
    // tail triangle
    const t0 = [136 * scale, (120 + 220) * scale]
    const t1 = [96 * scale, (120 + 220 + 84) * scale]
    const t2 = [220 * scale, (120 + 220) * scale]
    // point-in-triangle
    const s = (ax, ay, bx2, by2, cx2, cy2) => (bx2 - ax) * (cy2 - ay) - (by2 - ay) * (cx2 - ax)
    const d1 = s(px, py, t0[0], t0[1], t1[0], t1[1])
    const d2 = s(px, py, t1[0], t1[1], t2[0], t2[1])
    const d3 = s(px, py, t2[0], t2[1], t0[0], t0[1])
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0
    return !(hasNeg && hasPos)
  }
  // three "typing" dots inside the bubble
  const inDot = (px, py, cx, cy) => {
    const dx = px - cx, dy = py - cy
    return dx * dx + dy * dy <= (26 * scale) ** 2
  }
  const dots = [150 * scale, 256 * scale, 362 * scale].map((cx) => [cx, 230 * scale])

  return png(size, size, (x, y) => {
    // background: rounded gradient square
    const bgR = 96 * scale
    const inBg = inRounded(x, y, 0, 0, size, size, bgR)
    if (!inBg) return [0, 0, 0, 0]
    // gradient: top-left #7aa2f7 → bottom-right #2a2a6e
    const t = (x + y) / (2 * size)
    const r = Math.round(122 + (42 - 122) * t)
    const g = Math.round(162 + (42 - 162) * t)
    const b = Math.round(247 + (110 - 247) * t)
    // bubble (white)
    if (inBubble(x, y)) return [255, 255, 255, 255]
    // typing dots (accent blue)
    for (const [cx, cy] of dots) {
      if (inDot(x, y, cx, cy)) return [90, 120, 220, 255]
    }
    return [r, g, b, 255]
  })
}

// ── outputs ──
const iconset = join(OUT, 'icon.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })

const sizes = [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png']
]
for (const [s, name] of sizes) {
  writeFileSync(join(iconset, name), render(s))
}
writeFileSync(join(OUT, 'icon.png'), render(512))

// macOS .icns via iconutil
try {
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(OUT, 'icon.icns')])
  console.log('[icon] wrote build/icon.png + build/icon.icns')
} catch {
  console.warn('[icon] iconutil failed; keeping PNG only (icns skipped)')
}

// Windows .ico: single 256×256 PNG-compressed entry (Vista+ supported).
function writeIco(pngBuf, icoPath) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // count
  const entry = Buffer.alloc(16)
  entry.writeUInt8(0, 0) // width 0 = 256
  entry.writeUInt8(0, 1) // height 0 = 256
  entry.writeUInt8(0, 2) // palette
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // planes
  entry.writeUInt16LE(32, 6) // bit count
  entry.writeUInt32LE(pngBuf.length, 8) // bytes in resource
  entry.writeUInt32LE(header.length + entry.length, 12) // image offset
  writeFileSync(icoPath, Buffer.concat([header, entry, pngBuf]))
}
try {
  writeIco(render(256), join(OUT, 'icon.ico'))
  console.log('[icon] wrote build/icon.ico (256×256, Windows)')
} catch (e) {
  console.warn('[icon] icon.ico failed; Windows package falls back to default icon:', e.message)
}
console.log('[icon] done →', OUT)
