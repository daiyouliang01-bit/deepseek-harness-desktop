/**
 * Task 7.3 — PIN gate reverse proxy.
 *
 * Protects the dsh web backend (loopback only) behind a PIN prompt when the
 * app is exposed through a tunnel (cloudflared) or LAN access. The gate
 * listens on 127.0.0.1:<gatePort> and forwards to the actual dsh web port
 * (parsed from the runtime's ready URL), rewriting the Host header back to
 * 127.0.0.1:<upstreamPort> so the dsh browser-trust fence stays satisfied
 * and never sees the public hostname.
 *
 * Security model:
 *  - PIN is stored as a salted hash in userData/state/pin-hash.json.
 *  - Successful auth sets an httpOnly SameSite=Strict session cookie.
 *  - Brute-force protection: N failed attempts within the window locks the
 *    gate for lockoutMs, plus a per-attempt delay.
 *  - MIN_PIN_LENGTH guards the shortest acceptable PIN (4).
 *
 * The gate is NOT a replacement for account-grade auth (Cloudflare Access /
 * Tailscale). It raises the bar from "anyone on the internet" to "anyone who
 * knows the PIN". Choose a long PIN and change it periodically.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { connect as netConnect, type Socket } from 'node:net'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEVICE_COOKIE, PairStore, isLoopbackAddress, parseNamedCookie } from './pair-store'

const MIN_PIN_LENGTH = 4
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const SESSION_COOKIE = 'dsh_pin_gate'
const MAX_ATTEMPTS = 5
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const LOCKOUT_MS = 5 * 60 * 1000 // 5 minutes (was 15m; shorter = less aggravating to the legit user under a stranger-DoS lockout)
const ATTEMPT_DELAY_MS = 400 // per-attempt delay before responding

/**
 * Paths the gate proxies when `allowFullApp` is false (the default). The
 * phone-console surface only — every other dsh route (`/api`, `/sidebar`,
 * assets…) is refused so a PIN grants a mobile console, never the whole
 * desktop RPC surface (plan R34).
 */
const PHN_ROUTE_PREFIX = '/phn'
const ALLOWED_STANDALONE = new Set(['/', '/__pin', '/__health', '/favicon.ico'])

export interface PinGateOptions {
  /** Loopback port the gate listens on (e.g. 35881). */
  port: number
  /** Upstream base URL of dsh web, e.g. http://127.0.0.1:35880 */
  upstreamUrl: string
  /** Directory to persist the PIN hash (userData/state). */
  stateDir: string
  /**
   * Shared companion token (plan R30/R34). The gate injects it as
   * `x-dsh-companion-token` on every proxied request so the phone-sync
   * plugin can tell "came through our gate" apart from "random internet"
   * (and apart from plain loopback). Same value is used to prove identity
   * on `GET /__health?t=…` so the tunnel controller refuses to point a
   * public tunnel at a foreign process squatting on this port (R29).
   */
  companionToken: string
  /**
   * When false (default) only `/phn/*`, `/`, `/__pin`, `/__health` are
   * proxied; everything else gets 403 and `/` redirects to `/phn`. Set true
   * to expose the full dsh web UI through the PIN (plan R34 opt-in).
   */
  allowFullApp?: boolean
  /** Public origin printed into pairing QR (named tunnel). */
  publicBaseUrl?: string
}

interface StoredPin {
  salt: string
  hash: string
  updatedAt: number
}

interface Session {
  token: string
  createdAt: number
}

function sha256(salt: string, pin: string): string {
  return createHash('sha256').update(`${salt}:${pin}`).digest('hex')
}

/** Constant-time string equality (lengths differ → false, no early exit on content). */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export class PinGate {
  private readonly opts: PinGateOptions
  private server: Server | null = null
  private stored: StoredPin | null = null
  private sessions = new Map<string, Session>()
  /** Brute-force state. */
  private failures: number[] = []
  private lockedUntil = 0
  private hashPath: string
  private pairs: PairStore

  constructor(opts: PinGateOptions) {
    this.opts = opts
    this.hashPath = join(opts.stateDir, 'pin-hash.json')
    this.pairs = new PairStore(opts.stateDir, { publicBase: opts.publicBaseUrl })
    this.load()
  }
  // ----- persistence -----

  private load(): void {
    try {
      if (!existsSync(this.hashPath)) return
      const raw = readFileSync(this.hashPath, 'utf8')
      const data = JSON.parse(raw) as StoredPin
      if (typeof data.salt === 'string' && typeof data.hash === 'string') this.stored = data
    } catch {
      this.stored = null
    }
  }

  private save(): void {
    if (!this.stored) return
    try {
      mkdirSync(this.opts.stateDir, { recursive: true })
      writeFileSync(this.hashPath, JSON.stringify(this.stored, null, 2), { mode: 0o600 })
    } catch {
      /* persistence failure must not crash the app */
    }
  }

  /** True when a PIN has been configured. */
  hasPin(): boolean {
    return this.stored !== null
  }

  /** Set/replace the PIN. Min length enforced here (MIN_PIN_LENGTH). */
  setPin(pin: string): { ok: boolean; error?: string } {
    if (typeof pin !== 'string' || pin.length < MIN_PIN_LENGTH) {
      return { ok: false, error: `PIN 至少 ${MIN_PIN_LENGTH} 位` }
    }
    const salt = randomBytes(16).toString('hex')
    this.stored = { salt, hash: sha256(salt, pin), updatedAt: Date.now() }
    this.save()
    // New PIN invalidates all existing sessions.
    this.sessions.clear()
    return { ok: true }
  }

  private verify(pin: string): boolean {
    if (!this.stored || typeof pin !== 'string') return false
    const hash = sha256(this.stored.salt, pin)
    const a = Buffer.from(this.stored.hash, 'hex')
    const b = Buffer.from(hash, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  }

  // ----- brute-force guard -----

  private recordFailure(): void {
    const now = Date.now()
    this.failures = this.failures.filter((t) => now - t < ATTEMPT_WINDOW_MS)
    this.failures.push(now)
    if (this.failures.length >= MAX_ATTEMPTS) {
      this.lockedUntil = now + LOCKOUT_MS
      this.failures = []
    }
  }

  private isLocked(): boolean {
    if (Date.now() < this.lockedUntil) return true
    return false
  }

  private lockRemainingMs(): number {
    return Math.max(0, this.lockedUntil - Date.now())
  }

  /** Reset the brute-force lock/failure counter (owner-initiated via the desktop panel). */
  resetLock(): void {
    this.failures = []
    this.lockedUntil = 0
  }

  /** Public status snapshot for the shell UI. */
  status(): { enabled: boolean; locked: boolean; lockRemainingMs: number } {
    return { enabled: this.hasPin(), locked: this.isLocked(), lockRemainingMs: this.lockRemainingMs() }
  }

  mintPair(): ReturnType<PairStore['mint']> {
    return this.pairs.mint({ loopback: true, pinEnabled: this.hasPin() })
  }

  listPaired(): ReturnType<PairStore['list']> {
    return this.pairs.list()
  }

  revokePaired(id: string): ReturnType<PairStore['revoke']> {
    return this.pairs.revoke(id)
  }

  // ----- session management -----

  private issueSession(): string {
    const token = randomBytes(24).toString('base64url')
    this.sessions.set(token, { token, createdAt: Date.now() })
    // Opportunistic cleanup of expired sessions.
    for (const [k, s] of this.sessions) {
      if (Date.now() - s.createdAt > SESSION_TTL_MS) this.sessions.delete(k)
    }
    return token
  }

  private sessionValid(token: string | undefined): boolean {
    if (!token) return false
    const s = this.sessions.get(token)
    if (!s) return false
    if (Date.now() - s.createdAt > SESSION_TTL_MS) {
      this.sessions.delete(token)
      return false
    }
    return true
  }

  private parseCookie(req: IncomingMessage): string | undefined {
    const raw = req.headers.cookie
    if (!raw) return undefined
    for (const part of raw.split(';')) {
      const [k, ...rest] = part.trim().split('=')
      if (k === SESSION_COOKIE) return rest.join('=')
    }
    return undefined
  }

  // ----- pin page -----

  private renderPinPage(extra?: string): string {
    const locked = this.isLocked()
    const remaining = this.lockRemainingMs()
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeepSeek Harness</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#0f1115;color:#e8eaed;
    display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#1a1d24;border:1px solid #2a2e37;border-radius:14px;padding:32px 28px;
    width:min(340px,88vw);box-shadow:0 8px 30px rgba(0,0,0,.4)}
  h1{font-size:18px;margin:0 0 6px;font-weight:600}
  p{color:#9aa0a8;font-size:13px;margin:0 0 18px}
  input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #2a2e37;
    background:#0f1115;color:#e8eaed;font-size:16px;letter-spacing:2px;text-align:center}
  button{width:100%;margin-top:12px;padding:12px;border-radius:8px;border:none;
    background:#4f7cff;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  .err{color:#ff6b6b;font-size:12px;margin-top:10px;min-height:16px}
  .locked{color:#ffb84d;font-size:12px;margin-top:10px}
</style></head><body>
<div class="card">
  <h1>DeepSeek Harness</h1>
  ${this.hasPin() ? `
  <p>此实例受 PIN 保护,请输入访问密码</p>
  <form method="post" action="/__pin">
    <input type="password" name="pin" inputmode="numeric" autocomplete="current-password"
      minlength="4" autofocus ${locked ? 'disabled' : ''}>
    <button ${locked ? 'disabled' : ''}>解锁</button>
  </form>` : `
  <p>访问码尚未设置。请在桌面端打开「设置 → 手机」完成设置后重试。</p>
  <form method="post" action="/__pin">
    <input type="password" name="pin" inputmode="numeric" minlength="4" disabled>
    <button disabled>尚未设置访问码</button>
  </form>`}
  <div class="err">${extra ?? ''}</div>
  ${locked ? `<div class="locked">尝试过多,已锁定 ${Math.ceil(remaining / 60000)} 分钟</div>` : ''}
</div>
</body></html>`
  }

  // ----- core request handler -----

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)

    // Identity health probe (plan R29): lets the phone-sync tunnel controller
    // prove this port is OUR gate before pointing a public tunnel at it.
    // Loopback-only in practice; cheap, and requires the shared token.
    if (url.pathname === '/__health') {
      const t = url.searchParams.get('t') ?? ''
      const ok = this.opts.companionToken.length > 0 && timingSafeEqualStrings(t, this.opts.companionToken)
      res.writeHead(ok ? 200 : 403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(ok ? { ok: true, app: 'dsh-pin-gate' } : { ok: false }))
      return
    }

    if (url.pathname === '/__pair' && req.method === 'GET') {
      this.handlePairConsume(url, res)
      return
    }

    if (url.pathname === '/__pair/mint' || url.pathname === '/__pair/devices' || url.pathname === '/__pair/revoke') {
      this.handlePairAdmin(req, res, url)
      return
    }

    // PIN form submit
    if (url.pathname === '/__pin' && req.method === 'POST') {
      void this.handlePinSubmit(req, res)
      return
    }

    const pinOk = this.sessionValid(this.parseCookie(req))
    const device = this.pairs.verifyCookie(parseNamedCookie(req.headers.cookie, DEVICE_COOKIE))
    if (!pinOk && !device) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(this.renderPinPage())
      return
    }

    // Device cookie alone never unlocks the full Web UI (plan R1).
    if (device && !pinOk) {
      if (url.pathname === '/') {
        res.writeHead(302, { location: '/phn', 'cache-control': 'no-store' })
        res.end()
        return
      }
      if (!this.pathAllowed(url.pathname)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        res.end('403: paired phone may only use /phn')
        return
      }
    }

    // Path allow-list (plan R34): a PIN grants the phone console only.
    if (!this.allowFullApp()) {
      if (url.pathname === '/') {
        res.writeHead(302, { location: '/phn', 'cache-control': 'no-store' })
        res.end()
        return
      }
      if (!this.pathAllowed(url.pathname)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        res.end('403: path not exposed by the mobile console (allowFullApp is off)')
        return
      }
    }

    this.proxy(req, res, url)
  }

  /** Whether this gate exposes the full dsh web UI (plan R34 opt-in). */
  private allowFullApp(): boolean {
    return this.opts.allowFullApp === true
  }

  /** Whitelist check used when allowFullApp is off. */
  private pathAllowed(pathname: string): boolean {
    if (pathname === PHN_ROUTE_PREFIX || pathname.startsWith(PHN_ROUTE_PREFIX + '/')) return true
    return ALLOWED_STANDALONE.has(pathname)
  }

  private corsHeaders(req: IncomingMessage): Record<string, string> {
    const origin = String(req.headers.origin ?? '')
    const allow =
      origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://localhost:') ? origin : ''
    const headers: Record<string, string> = {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    }
    if (allow) {
      headers['access-control-allow-origin'] = allow
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS'
      headers['access-control-allow-headers'] = 'content-type'
    }
    return headers
  }

  private handlePairAdmin(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const loopback = isLoopbackAddress(req.socket.remoteAddress)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, this.corsHeaders(req))
      res.end()
      return
    }
    const send = (status: number, obj: unknown) => {
      res.writeHead(status, this.corsHeaders(req))
      res.end(JSON.stringify(obj))
    }
    if (!loopback) {
      send(404, { ok: false, error: 'not found' })
      return
    }
    if (url.pathname === '/__pair/mint' && req.method === 'POST') {
      send(200, this.pairs.mint({ loopback: true, pinEnabled: this.hasPin() }))
      return
    }
    if (url.pathname === '/__pair/devices' && req.method === 'GET') {
      send(200, { ok: true, value: this.pairs.list() })
      return
    }
    if (url.pathname === '/__pair/revoke' && req.method === 'POST') {
      void this.readJsonBody(req).then((body) => {
        const id = typeof body.id === 'string' ? body.id : ''
        send(200, this.pairs.revoke(id || '*'))
      })
      return
    }
    send(404, { ok: false, error: 'not found' })
  }

  private readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>)
        } catch {
          resolve({})
        }
      })
      req.on('error', () => resolve({}))
    })
  }

  private handlePairConsume(url: URL, res: ServerResponse): void {
    const ticket = url.searchParams.get('t') ?? ''
    const out = this.pairs.consume(ticket)
    if (!out.ok || !out.cookieValue) {
      res.writeHead(400, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      })
      res.end(this.renderPairResult(false, out.error || '绑定码无效或已过期，请回桌面重新生成二维码。'))
      return
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': this.pairs.cookieHeader(out.cookieValue),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    res.end(this.renderPairResult(true, '这台手机已绑定，以后打开不用再输入 PIN。'))
  }

  private renderPairResult(ok: boolean, message: string): string {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
${ok ? '<meta http-equiv="refresh" content="0;url=/phn"/>' : ''}
<title>${ok ? '已绑定' : '绑定失败'}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f1115;color:#e8eaed;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}
  .card{background:#1a1d24;border:1px solid #2a2e37;border-radius:14px;padding:28px;width:min(360px,88vw)}
  a{color:#8ab4ff}
</style></head><body><div class="card">
  <h1>${ok ? '绑定成功' : '绑定失败'}</h1>
  <p>${message}</p>
  ${ok ? '<p><a href="/phn">进入手机页</a>（无需 PIN）</p><script>location.replace("/phn")</script>' : '<p>请回到桌面「设置 → 手机」重新生成。</p>'}
</div></body></html>`
  }

  private async handlePinSubmit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.isLocked()) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(this.renderPinPage('已锁定,请稍后再试'))
      return
    }
    // Read the POST body with the classic 'data'/'end' events instead of an
    // async iterator; some clients stall with for-await on keep-alive sockets.
    const body = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolve(''))
    })
    const pin = new URLSearchParams(body).get('pin') ?? ''

    await new Promise((r) => setTimeout(r, ATTEMPT_DELAY_MS))

    if (this.verify(pin)) {
      const token = this.issueSession()
      res.writeHead(303, {
        location: '/',
        'set-cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
      })
      res.end()
      return
    }
    this.recordFailure()
    const locked = this.isLocked()
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(this.renderPinPage(locked ? '尝试过多,已锁定' : 'PIN 错误'))
  }

  // ----- reverse proxy -----

  private proxy(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const upstream = new URL(this.opts.upstreamUrl)
    const headers: Record<string, string | string[]> = { ...req.headers as Record<string, string | string[]> }
    // Host rewrite: dsh's browser-trust fence only accepts loopback hosts.
    headers.host = `127.0.0.1:${upstream.port}`
    // Origin/Referer rewrite: the fence also validates the Origin against
    // the accepted Host. The browser sends Origin: http://127.0.0.1:<gate>,
    // which must be rewritten to the upstream loopback origin or the fence
    // rejects every /api call with 403.
    if (typeof headers.origin === 'string') {
      headers.origin = `http://127.0.0.1:${upstream.port}`
    }
    if (typeof headers.referer === 'string') {
      try {
        const r = new URL(headers.referer)
        headers.referer = `http://127.0.0.1:${upstream.port}${r.pathname}${r.search}`
      } catch {
        /* keep as-is */
      }
    }
    // Strip our auth cookie before forwarding upstream.
    const cookies = (headers.cookie as string | undefined)?.split(';').map((c) => c.trim())
      .filter((c) => !c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${DEVICE_COOKIE}=`)) ?? []
    if (cookies.length > 0) headers.cookie = cookies.join('; ')
    else delete headers.cookie
    // Tunnels may send X-Forwarded-* that we should not pass through
    delete headers['x-forwarded-for']
    delete headers['x-forwarded-proto']
    delete headers['x-forwarded-host']
    // Companion token (plan R30/R34): marks this request as having crossed
    // OUR gate, for the phone-sync plugin's per-route auth to trust.
    if (this.opts.companionToken) headers['x-dsh-companion-token'] = this.opts.companionToken

    const preq = httpRequest({
      hostname: upstream.hostname,
      port: upstream.port,
      path: url.pathname + url.search,
      method: req.method ?? 'GET',
      headers,
      // One request per client connection: avoids pooling keep-alive sockets
      // toward dsh. Each proxied request gets its own connection that closes
      // when the response completes.
      agent: false
    })
    // NOTE: do NOT preq.destroy() on response completion — the response body
    // may still be streaming to the client (large HTML/API payloads). With
    // agent:false the socket closes naturally when both sides finish.
    preq.on('response', (pres) => {
      res.writeHead(pres.statusCode ?? 502, pres.headers)
      // Manual forwarding instead of pipe: pipe() can silently drop data when
      // the destination pauses (backpressure) while the source errors/ends.
      pres.on('data', (chunk: Buffer) => {
        if (!res.write(chunk)) pres.pause()
      })
      pres.on('end', () => res.end())
      pres.on('error', () => res.end())
      res.on('drain', () => pres.resume())
    })
    preq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`upstream unreachable: ${err.message}`)
      } else {
        res.end()
      }
    })
    // Do NOT destroy the upstream request on req close: Electron's
    // IncomingMessage can emit 'close' before the upstream response is fully
    // consumed, which would truncate large bodies. With agent:false the
    // upstream socket closes naturally when the response completes.
    req.pipe(preq)
  }

  // ----- websocket proxy -----

  private handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    if (!this.sessionValid(this.parseCookie(req))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const upstream = new URL(this.opts.upstreamUrl)

    // Build the upstream request with the exact WS handshake headers.
    const headers: Record<string, string> = { ...req.headers as Record<string, string> }
    headers.host = `127.0.0.1:${upstream.port}`
    // Origin rewrite for the same browser-trust fence reason as HTTP.
    if (typeof headers.origin === 'string') {
      headers.origin = `http://127.0.0.1:${upstream.port}`
    }
    delete headers['x-forwarded-for']
    delete headers['x-forwarded-proto']
    delete headers['x-forwarded-host']
    // Companion token for the WS path too (plan R30/R34).
    if (this.opts.companionToken) headers['x-dsh-companion-token'] = this.opts.companionToken

    const upstreamSocket = netConnect(Number(upstream.port), upstream.hostname, () => {
      const path = req.url ?? '/'
      const lines = [
        `GET ${path} HTTP/1.1`,
        `Host: ${headers.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${headers['sec-websocket-key'] ?? ''}`,
        `Sec-WebSocket-Version: ${headers['sec-websocket-version'] ?? '13'}`
      ]
      if (headers['sec-websocket-protocol']) lines.push(`Sec-WebSocket-Protocol: ${headers['sec-websocket-protocol']}`)
      if (headers.origin) lines.push(`Origin: ${headers.origin}`)
      if (req.headers.cookie) lines.push(`Cookie: ${req.headers.cookie}`)
      if (this.opts.companionToken) lines.push(`X-Dsh-Companion-Token: ${this.opts.companionToken}`)
      upstreamSocket.write(lines.join('\r\n') + '\r\n\r\n')
      // Forward any buffered client payload (e.g. early WS frames) upstream.
      if (head.length > 0) upstreamSocket.write(head)
    })
    upstreamSocket.on('error', () => {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      socket.destroy()
    })
    // Once the upstream answers (101), relay the status line + headers to the
    // client, then bridge bytes both ways (including any buffered head).
    upstreamSocket.on('data', function onUpstreamData(chunk: Buffer): void {
      // First chunk contains the upstream's 101 response headers.
      const idx = chunk.indexOf('\r\n\r\n')
      if (idx >= 0) {
        const headerText = chunk.subarray(0, idx + 4).toString()
        const rest = chunk.subarray(idx + 4)
        // Validate upstream agreed to upgrade.
        if (/^HTTP\/1\.1 101/i.test(headerText)) {
          socket.write(headerText)
          if (head.length > 0) socket.write(head)
          if (rest.length > 0) socket.write(rest)
          upstreamSocket.removeListener('data', onUpstreamData)
          upstreamSocket.pipe(socket)
          socket.pipe(upstreamSocket)
        } else {
          socket.write(headerText)
          if (rest.length > 0) socket.write(rest)
          socket.destroy()
        }
      }
      // If headers don't arrive in one chunk, keep buffering by re-listening;
      // in practice 101 responses are tiny and arrive in one chunk.
    })
    socket.on('close', () => upstreamSocket.destroy())
    upstreamSocket.on('close', () => socket.destroy())
  }

  // ----- lifecycle -----

  /** Start listening. Returns the bound port (same as opts.port). */
  async start(): Promise<number> {
    if (this.server) return this.opts.port
    this.server = createServer((req, res) => this.handleRequest(req, res))
    // The upgrade event's socket is a net.Socket at runtime; the types say
    // Duplex, so narrow it for the proxy helpers.
    this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket as Socket, head))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.opts.port, '127.0.0.1', () => resolve())
    })
    return this.opts.port
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }
}
