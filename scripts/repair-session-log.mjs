#!/usr/bin/env node
/**
 * repair-session-log.mjs — emergency repair for a DSH session log corrupted
 * by a seq rewind ("corrupt session log: seq gap in committed region").
 *
 * Background (2026-08-16): multiple dsh instances writing the same
 * session.jsonl.zstd concurrently interleave their appends; each process
 * numbers events from its own in-memory counter, so the file can contain a
 * backward seq jump. The host refuses to load such a log (history "gone").
 * The data itself is intact — this tool re-sequences the events into a
 * contiguous 0..N-1 range and rewrites the file.
 *
 * Usage:
 *   node scripts/repair-session-log.mjs <session.jsonl.zstd> [--dry-run] [--force] [--no-backup]
 *
 *   --dry-run   decode + re-sequence + verify, but write nothing
 *   --force     skip the R11 guard (a dsh instance is running — NOT recommended)
 *   --no-backup don't keep a .repair-bak copy of the original
 *
 * Guard (R11): refuses to run (except --dry-run, which writes nothing) while
 * any dsh process is running — a live dsh would re-corrupt the repaired file.
 */

import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const USAGE = `Usage: node scripts/repair-session-log.mjs <session.jsonl.zstd> [--dry-run] [--force] [--no-backup]`

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const pathArg = args.find((a) => !a.startsWith('--'))
if (!pathArg) {
  console.error(USAGE)
  process.exit(2)
}
const SESSION_PATH = resolve(pathArg)
const DRY_RUN = flags.has('--dry-run')
const FORCE = flags.has('--force')
const NO_BACKUP = flags.has('--no-backup')
const BACKUP_PATH = SESSION_PATH + '.repair-bak'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const CHUNK_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

/** R11: refuse while a dsh process is running (dry-run is read-only → allowed). */
function guard() {
  if (DRY_RUN || FORCE) return
  try {
    const out = execFileSync('/bin/ps', ['aux'], { encoding: 'utf8' })
    const dsh = out.split('\n').filter((l) => /dsh|bin\.js/.test(l) && !l.includes('repair-session-log'))
    if (dsh.length > 0) {
      console.error(
        `[guard] 检测到 ${dsh.length} 个 dsh 进程正在运行（R11）——修复后的文件会被再次写坏。\n` +
          "请先停止所有 dsh（如 'dsh' 服务、桌面应用），再运行本工具；\n" +
          '或使用 --dry-run 只预览不写入，或 --force 强制（不推荐）。'
      )
      process.exit(3)
    }
  } catch {
    /* ps unavailable — proceed (best effort) */
  }
}

function findFrames(buf) {
  const positions = []
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === ZSTD_MAGIC[0] && buf[i + 1] === ZSTD_MAGIC[1] && buf[i + 2] === ZSTD_MAGIC[2] && buf[i + 3] === ZSTD_MAGIC[3]) {
      positions.push(i)
      i += 3
    }
  }
  return positions.map((p, i) => [p, positions[i + 1] || buf.length])
}

function chunkMembers(record) {
  if (record.type === 'tool-call-chunks') return record.data?.args
  if (record.type === 'text-chunks' || record.type === 'reasoning-chunks') return record.data?.texts
  return undefined
}

/**
 * Decode all frames, re-sequence every event into a contiguous 0..N-1 range,
 * remap nested seq references, and return the repaired JSONL lines.
 * Throws with a clear message when any frame is undecodable.
 */
function repair(raw) {
  const frames = findFrames(raw)
  if (frames.length === 0) throw new Error('no zstd frames found — not a session.jsonl.zstd file?')

  const records = []
  for (const [s, e] of frames) {
    const text = zstdDecompressSync(raw.subarray(s, e)).toString('utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      records.push(JSON.parse(line))
    }
  }
  console.log(`解码: ${frames.length} 帧, ${records.length} 条记录`)

  // Build old→new seq map by walking records in order.
  const remap = new Map()
  const spans = [] // per record: {newSeq} or {newSeq0, count} or null
  let cursor = 0
  for (const rec of records) {
    const members = chunkMembers(rec)
    if (members !== undefined && Array.isArray(members)) {
      const newSeq0 = cursor
      for (let k = 0; k < members.length; k++) {
        if (!remap.has(rec.seq0 + k)) remap.set(rec.seq0 + k, newSeq0 + k)
      }
      spans.push({ newSeq0, count: members.length })
      cursor += members.length
    } else if (typeof rec.seq === 'number') {
      if (!remap.has(rec.seq)) remap.set(rec.seq, cursor)
      spans.push({ newSeq: cursor })
      cursor += 1
    } else {
      spans.push(null)
    }
  }
  console.log(`重排: ${cursor} 个事件 (原最大 seq ${Math.max(0, ...records.map((r) => r.seq ?? r.seq0 ?? 0))})`)

  const remapOne = (v) => (typeof v === 'number' ? remap.get(v) ?? v : v)
  const remapList = (arr) => (Array.isArray(arr) ? arr.map((x) => remap.get(x) ?? x) : arr)

  const outLines = []
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const span = spans[i]
    if (span) {
      if (span.newSeq0 !== undefined) rec.seq0 = span.newSeq0
      else rec.seq = span.newSeq
    }
    const d = rec.data
    if (d && typeof d === 'object') {
      if (Array.isArray(d.messageSeqs)) d.messageSeqs = remapList(d.messageSeqs)
      if (Array.isArray(d.sourceEventSeqs)) d.sourceEventSeqs = remapList(d.sourceEventSeqs)
      if (Array.isArray(d.shadowedSeqs)) d.shadowedSeqs = remapList(d.shadowedSeqs)
      if (typeof d.sourceEventSeq === 'number') d.sourceEventSeq = remapOne(d.sourceEventSeq)
    }
    outLines.push(JSON.stringify(rec))
  }
  return { lines: outLines, eventCount: cursor }
}

/** Simulate the host scanner: every expanded event's seq must equal its index. */
function verifyContiguity(lines) {
  let expected = 0
  let violations = 0
  for (const line of lines) {
    const rec = JSON.parse(line)
    const members = chunkMembers(rec)
    if (members !== undefined && Array.isArray(members)) {
      if (rec.seq0 !== expected) violations++
      expected += members.length
    } else if (typeof rec.seq === 'number') {
      if (rec.seq !== expected) violations++
      expected += 1
    }
  }
  return { violations, eventCount: expected }
}

/**
 * Pack repaired lines into zstd frames. Frame 0 must be EXACTLY the header
 * line + newline (host's assertZstdHeaderFrame: the only \n is the last byte);
 * the rest goes into ~256KB plaintext frames.
 */
function pack(lines) {
  const header = lines[0]
  const rest = lines.slice(1)
  if (!header || !header.startsWith('{"type":"session"')) {
    throw new Error('first record is not the session header — refusing to pack')
  }
  const frameTexts = [header + '\n']
  const TARGET = 256 * 1024
  let cur = ''
  for (const l of rest) {
    cur += l + '\n'
    if (cur.length >= TARGET) {
      frameTexts.push(cur)
      cur = ''
    }
  }
  if (cur) frameTexts.push(cur)
  return Buffer.concat(frameTexts.map((t) => zstdCompressSync(Buffer.from(t, 'utf8'))))
}

function main() {
  if (!existsSync(SESSION_PATH)) {
    console.error(`文件不存在: ${SESSION_PATH}`)
    process.exit(2)
  }
  console.log(`会话日志: ${SESSION_PATH} (${statSync(SESSION_PATH).size} bytes)`)
  guard()

  const raw = readFileSync(SESSION_PATH)
  let repaired
  try {
    repaired = repair(raw)
  } catch (err) {
    console.error(`解码/重排失败: ${err.message}`)
    process.exit(1)
  }

  const { violations, eventCount } = verifyContiguity(repaired.lines)
  console.log(`连续性校验: ${violations === 0 ? '✅ 通过' : `❌ ${violations} 处违例`} (${eventCount} 事件)`)

  if (violations > 0) {
    console.error('重排后仍不连续——中止，原文件未改动。')
    process.exit(1)
  }

  if (DRY_RUN) {
    console.log('--dry-run: 未写入任何文件。')
    return
  }

  if (!NO_BACKUP) {
    copyFileSync(SESSION_PATH, BACKUP_PATH)
    console.log(`备份: ${BACKUP_PATH}`)
  }

  const out = pack(repaired.lines)
  const outPath = SESSION_PATH + '.repaired'
  writeFileSync(outPath, out)
  console.log(`写入: ${outPath} (${out.length} bytes)`)

  // Self-verify the written file round-trips.
  const checkRaw = readFileSync(outPath)
  const checkFrames = findFrames(checkRaw)
  let checkText = ''
  for (const [s, e] of checkFrames) checkText += zstdDecompressSync(checkRaw.subarray(s, e)).toString('utf8')
  const checkLines = checkText.split('\n').filter((l) => l.trim())
  const check = verifyContiguity(checkLines)
  if (check.violations === 0 && checkLines.length === repaired.lines.length) {
    console.log(`回读自校验: ✅ 通过 (${checkLines.length} 行)`)
    console.log('\n修复成功。请将 .repaired 文件替换原文件：')
    console.log(`  mv ${outPath} ${SESSION_PATH}`)
    console.log('（替换前确认所有 dsh 已停止；替换后重启服务即可恢复历史）')
  } else {
    console.error(`回读自校验失败 (${check.violations} 违例) — 原文件未改动，请检查 ${outPath}`)
    process.exit(1)
  }
}

main()
