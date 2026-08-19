/**
 * Compact QR (byte mode, EC-M) → SVG. Enough for pairing URLs (~80 chars).
 */
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i += 1) {
  EXP[i] = x
  LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

function rsGenerator(ec: number): number[] {
  let poly = [1]
  for (let i = 0; i < ec; i += 1) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]
      next[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

function rsEncode(data: number[], ec: number): number[] {
  const gen = rsGenerator(ec)
  const res = new Array(ec).fill(0)
  for (const byte of data) {
    const factor = byte ^ (res.shift() as number)
    res.push(0)
    if (factor === 0) continue
    for (let i = 0; i < gen.length - 1; i += 1) res[i] ^= mul(gen[i + 1], factor)
  }
  return res
}

/** Version 1–6 EC-M: [total codewords, ec per block, blocks] */
const VERSIONS: Array<[number, number, number, number]> = [
  [1, 21, 16, 10],
  [2, 25, 28, 16],
  [3, 29, 44, 26],
  [4, 33, 64, 36],
  [5, 37, 86, 48],
  [6, 41, 108, 64],
]

function bitsToBytes(bits: string): number[] {
  const padded = bits + '0'.repeat((8 - (bits.length % 8)) % 8)
  const out: number[] = []
  for (let i = 0; i < padded.length; i += 8) out.push(parseInt(padded.slice(i, i + 8), 2))
  return out
}

function placeFinder(mod: number[][], x: number, y: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || yy < 0 || xx >= mod.length || yy >= mod.length) continue
      const on = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4))
      mod[yy][xx] = on ? 1 : 0
    }
  }
}

function reserved(size: number): boolean[][] {
  const r = Array.from({ length: size }, () => Array(size).fill(false))
  const mark = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) {
      if (xx >= 0 && yy >= 0 && xx < size && yy < size) r[yy][xx] = true
    }
  }
  mark(0, 0, 9, 9)
  mark(size - 8, 0, 8, 9)
  mark(0, size - 8, 9, 8)
  mark(6, 0, 1, size)
  mark(0, 6, size, 1)
  return r
}

function maskBit(x: number, y: number): boolean {
  return ((x + y) % 2) === 0
}

export function qrSvg(text: string): string {
  const payload = Array.from(new TextEncoder().encode(text))
  const needed = payload.length + 2 + 1
  const spec = VERSIONS.find((row) => row[2] - 2 >= needed) ?? VERSIONS[VERSIONS.length - 1]
  const [, size, dataCount, ecCount] = spec
  let bits = '0100' + payload.length.toString(2).padStart(8, '0')
  for (const b of payload) bits += b.toString(2).padStart(8, '0')
  bits += '0000'
  const data = bitsToBytes(bits)
  while (data.length < dataCount) data.push(data.length % 2 === 0 ? 0xec : 0x11)
  data.length = dataCount
  const codewords = data.concat(rsEncode(data, ecCount))
  const modules = Array.from({ length: size }, () => Array(size).fill(0))
  const lock = reserved(size)
  placeFinder(modules, 0, 0)
  placeFinder(modules, size - 7, 0)
  placeFinder(modules, 0, size - 7)
  for (let i = 0; i < size; i += 1) {
    modules[6][i] = i % 2 === 0 ? 1 : 0
    modules[i][6] = i % 2 === 0 ? 1 : 0
    lock[6][i] = true
    lock[i][6] = true
  }
  let bit = 0
  const totalBits = codewords.length * 8
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5
    for (let rowPass = 0; rowPass < size; rowPass += 1) {
      const y = ((size - 1 - col) & 2) === 0 ? size - 1 - rowPass : rowPass
      for (let dx = 0; dx < 2; dx += 1) {
        const x = col - dx
        if (lock[y][x]) continue
        const value = bit < totalBits ? ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) : 0
        bit += 1
        modules[y][x] = value ^ (maskBit(x, y) ? 1 : 0)
      }
    }
  }
  const format = 0b101010000010010
  const formatBits = format.toString(2).padStart(15, '0')
  const put = (x: number, y: number, v: number) => { modules[y][x] = v }
  for (let i = 0; i < 6; i += 1) put(i, 8, Number(formatBits[i]))
  put(7, 8, Number(formatBits[6]))
  put(8, 8, Number(formatBits[7]))
  put(8, 7, Number(formatBits[8]))
  for (let i = 0; i < 6; i += 1) put(8, 5 - i, Number(formatBits[9 + i]))
  for (let i = 0; i < 8; i += 1) put(size - 1 - i, 8, Number(formatBits[i]))
  for (let i = 0; i < 7; i += 1) put(8, size - 7 + i, Number(formatBits[8 + i]))
  modules[size - 8][8] = 1

  const scale = 8
  const pad = 4
  const dim = (size + pad * 2) * scale
  let rects = ''
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!modules[y][x]) continue
      rects += `<rect x="${(x + pad) * scale}" y="${(y + pad) * scale}" width="${scale}" height="${scale}"/>`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="220" height="220" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>${rects.replace(/<rect/g, '<rect fill="#111"')}</svg>`
}
