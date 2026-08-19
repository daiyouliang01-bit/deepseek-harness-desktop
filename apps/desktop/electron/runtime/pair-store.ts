/**
 * Device pairing store (docs/qr-pair-permanent-link-plan.md v1.3).
 * Tickets: 60s, single-use. Device secrets hashed at rest.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { qrSvg } from './qr-svg'

export const TICKET_TTL_MS = 10 * 60_000
export const DEVICE_COOKIE = 'dsh_device'
export const DEVICE_MAX = 5
export const COOKIE_MAX_AGE_SEC = 180 * 24 * 60 * 60

interface Ticket {
  t: string
  expAbs: number
  used: boolean
}

export interface PairedDevice {
  id: string
  secretHash: string
  label: string
  createdAt: number
  lastSeenAt: number
  revokedAt: number | null
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function safeEqHex(a: string, b: string): boolean {
  const ba = Buffer.from(String(a), 'hex')
  const bb = Buffer.from(String(b), 'hex')
  if (ba.length !== bb.length || ba.length === 0) return false
  return timingSafeEqual(ba, bb)
}

export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false
  const a = String(addr).replace('::ffff:', '')
  return a === '127.0.0.1' || a === '::1' || a === 'localhost'
}

export function parseNamedCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return undefined
}

export function leafWorkflowEvent(
  kind: string,
  sessionId: string,
  extra: Record<string, unknown> = {},
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    kind,
    sessionId: String(sessionId || ''),
    time: Date.now(),
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === null || v === undefined) continue
    const t = typeof v
    if (t === 'string') out[k] = (v as string).slice(0, 200)
    else if (t === 'number' || t === 'boolean') out[k] = v as number | boolean
  }
  return out
}

export class PairStore {
  private readonly path: string
  private readonly now: () => number
  private readonly publicBase: string
  private tickets = new Map<string, Ticket>()
  private devices: PairedDevice[] = []

  constructor(stateDir: string, opts?: { now?: () => number; publicBase?: string }) {
    this.path = join(stateDir, 'paired-devices.json')
    this.now = opts?.now ?? (() => Date.now())
    this.publicBase = (opts?.publicBase ?? 'https://dsh.dpharness.xyz').replace(/\/$/, '')
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as { version?: number; devices?: PairedDevice[] }
      if (raw && raw.version === 1 && Array.isArray(raw.devices)) {
        this.devices = raw.devices.filter((d) => d && d.id && d.secretHash && !d.revokedAt)
      }
    } catch {
      try {
        if (existsSync(this.path)) {
          writeFileSync(this.path + '.corrupt-' + this.now(), readFileSync(this.path))
        }
      } catch {
        /* ignore */
      }
      this.devices = []
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = this.path + '.tmp'
    writeFileSync(tmp, JSON.stringify({ version: 1, devices: this.devices }, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  private purgeTickets(): void {
    const n = this.now()
    for (const [k, t] of this.tickets) {
      if (t.used || n > t.expAbs) this.tickets.delete(k)
    }
  }

  mint(input: { loopback: boolean; pinEnabled: boolean }): {
    ok: boolean
    status?: number
    error?: string
    url?: string
    exp?: number
    qrSvg?: string
  } {
    if (!input.loopback) return { ok: false, status: 404, error: 'not found' }
    if (!input.pinEnabled) return { ok: false, status: 400, error: 'PIN 未设置，无法签发绑定码' }
    this.purgeTickets()
    if (this.devices.filter((d) => !d.revokedAt).length >= DEVICE_MAX) {
      return { ok: false, status: 409, error: '已达 5 台上限，请先解除' }
    }
    const t = randomBytes(24).toString('base64url')
    const expAbs = this.now() + TICKET_TTL_MS
    this.tickets.set(t, { t, expAbs, used: false })
    const url = `${this.publicBase}/__pair?t=${encodeURIComponent(t)}`
    return { ok: true, url, exp: expAbs, qrSvg: qrSvg(url) }
  }

  consume(ticket: string): { ok: boolean; status?: number; error?: string; id?: string; cookieValue?: string } {
    this.purgeTickets()
    const rec = this.tickets.get(ticket)
    if (!rec || rec.used || this.now() > rec.expAbs) {
      return { ok: false, status: 400, error: '绑定码无效或已过期' }
    }
    rec.used = true
    this.tickets.delete(ticket)
    if (this.devices.filter((d) => !d.revokedAt).length >= DEVICE_MAX) {
      return { ok: false, status: 409, error: '已达 5 台上限，请先解除' }
    }
    const id = 'dev_' + randomBytes(8).toString('hex')
    const secret = randomBytes(32).toString('base64url')
    const now = this.now()
    this.devices.push({
      id,
      secretHash: sha256hex(secret),
      label: '手机',
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    })
    this.save()
    return { ok: true, id, cookieValue: `${id}.${secret}` }
  }

  verifyCookie(raw: string | undefined): PairedDevice | null {
    if (!raw || !raw.includes('.')) return null
    const i = raw.indexOf('.')
    const id = raw.slice(0, i)
    const secret = raw.slice(i + 1)
    const d = this.devices.find((x) => x.id === id && !x.revokedAt)
    if (!d) return null
    if (!safeEqHex(d.secretHash, sha256hex(secret))) return null
    const n = this.now()
    if (!d.lastSeenAt || n - d.lastSeenAt > 10 * 60 * 1000) {
      d.lastSeenAt = n
      try {
        this.save()
      } catch {
        /* auth still succeeds */
      }
    }
    return d
  }

  list(): { id: string; label: string; createdAt: number; lastSeenAt: number }[] {
    return this.devices
      .filter((d) => !d.revokedAt)
      .map((d) => ({ id: d.id, label: d.label, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt }))
  }

  revoke(id: string): { ok: boolean; status?: number; error?: string; id?: string } {
    if (id === '*') {
      for (const d of this.devices) d.revokedAt = this.now()
      this.save()
      return { ok: true }
    }
    const d = this.devices.find((x) => x.id === id)
    if (!d || d.revokedAt) return { ok: false, status: 404, error: 'not found' }
    d.revokedAt = this.now()
    this.save()
    return { ok: true, id }
  }

  cookieHeader(value: string): string {
    return `${DEVICE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}`
  }
}

