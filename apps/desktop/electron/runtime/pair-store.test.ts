import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEVICE_MAX, PairStore, TICKET_TTL_MS, isLoopbackAddress, leafWorkflowEvent } from './pair-store'

function store(clock: { now: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'pair-'))
  const s = new PairStore(dir, { now: () => clock.now, publicBase: 'https://dsh.dpharness.xyz' })
  return { s, dir }
}

describe('PairStore', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it('rejects non-loopback mint and missing PIN', () => {
    const clock = { now: 1_000_000 }
    const { s, dir } = store(clock)
    dirs.push(dir)
    expect(s.mint({ loopback: false, pinEnabled: true }).status).toBe(404)
    expect(s.mint({ loopback: true, pinEnabled: false }).status).toBe(400)
    const ok = s.mint({ loopback: true, pinEnabled: true })
    expect(ok.ok).toBe(true)
    expect(ok.url).toMatch(/^https:\/\/dsh\.dpharness\.xyz\/__pair\?t=/)
    expect(ok.qrSvg).toContain('<svg')
    expect(JSON.stringify(ok)).not.toMatch(/companion|PIN=/)
  })

  it('ticket is single-use and expires', () => {
    const clock = { now: 2_000_000 }
    const { s, dir } = store(clock)
    dirs.push(dir)
    const t = new URL(s.mint({ loopback: true, pinEnabled: true }).url!).searchParams.get('t')!
    expect(s.consume(t).ok).toBe(true)
    expect(s.consume(t).ok).toBe(false)
    const t2 = new URL(s.mint({ loopback: true, pinEnabled: true }).url!).searchParams.get('t')!
    clock.now += TICKET_TTL_MS + 1
    expect(s.consume(t2).ok).toBe(false)
  })

  it('persists and revoke invalidates cookie', () => {
    const clock = { now: 3_000_000 }
    const { s, dir } = store(clock)
    dirs.push(dir)
    const t = new URL(s.mint({ loopback: true, pinEnabled: true }).url!).searchParams.get('t')!
    const { cookieValue, id } = s.consume(t)
    expect(s.verifyCookie(cookieValue)).toBeTruthy()
    const s2 = new PairStore(dir, { now: () => clock.now })
    expect(s2.verifyCookie(cookieValue)).toBeTruthy()
    s2.revoke(id!)
    expect(s2.verifyCookie(cookieValue)).toBeNull()
  })

  it('corrupt file starts empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pair-bad-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'paired-devices.json'), '{not json')
    const s = new PairStore(dir, { now: () => 1 })
    expect(s.list()).toEqual([])
  })

  it('caps at 5 devices', () => {
    const clock = { now: 4_000_000 }
    const { s, dir } = store(clock)
    dirs.push(dir)
    for (let i = 0; i < DEVICE_MAX; i++) {
      const t = new URL(s.mint({ loopback: true, pinEnabled: true }).url!).searchParams.get('t')!
      expect(s.consume(t).ok).toBe(true)
      clock.now += 10
    }
    expect(s.mint({ loopback: true, pinEnabled: true }).status).toBe(409)
  })

  it('loopback helper and leaf events', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('8.8.8.8')).toBe(false)
    const ev = leafWorkflowEvent('workflow/phase', 'sid', { title: '编译', agent: { x: 1 }, message: 'x'.repeat(500) })
    expect(ev.title).toBe('编译')
    expect(ev.agent).toBeUndefined()
    expect(String(ev.message).length).toBe(200)
  })
})
