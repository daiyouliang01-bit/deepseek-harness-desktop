import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, request as httpRequest, type IncomingMessage, type Server as HTTPServer, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PinGate } from './pin-gate'
import { findFreePort } from './port-probe'

const TOKEN = 'test-companion-token-0123456789abcdef'

describe('PinGate (plan R16/R17/R29/R30/R33/R34)', () => {
  let stateDir: string
  let gatePort = 0
  let upstream: HTTPServer
  let upstreamSeen: { path: string; token?: string }[] = []
  let gate: PinGate

  const startUpstream = () => new Promise<number>((resolve) => {
    upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
      upstreamSeen.push({ path: req.url ?? '/', token: String(req.headers['x-dsh-companion-token'] ?? '') })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, upstream: req.url }))
    })
    upstream.listen(0, '127.0.0.1', () => resolve((upstream.address() as { port: number }).port))
  })

  const startGate = async (allowFullApp = false) => {
    gate = new PinGate({
      port: gatePort,
      upstreamUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`,
      stateDir,
      companionToken: TOKEN,
      allowFullApp
    })
    await gate.start()
  }

  type Resp = { status: number; headers: Record<string, string | string[] | undefined>; body: string }

  const request = (port: number, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Resp> =>
    new Promise((resolve) => {
      const u = new URL(`http://127.0.0.1:${port}${path}`)
      const req = httpRequest({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: opts.method ?? 'GET',
        headers: opts.headers,
        // One connection per request: the client must not reuse a pooled
        // keep-alive socket pointing at a previous test's closed server.
        agent: false
      }, (res: IncomingMessage) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
      })
      req.on('error', (e: Error) => resolve({ status: 0, headers: {}, body: `ERR:${e.message}` }))
      if (opts.body) req.end(opts.body)
      else req.end()
    })

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'pin-gate-'))
    await startUpstream()
    gatePort = (await findFreePort(39_000, 30)) as number
    upstreamSeen = []
  })

  afterEach(async () => {
    gate?.stop()
    await new Promise<void>((resolve) => upstream?.close(() => resolve()))
    rmSync(stateDir, { recursive: true, force: true })
  })

  it('R29: /__health confirms identity only with the shared token', async () => {
    await startGate()
    const ok = await request(gatePort, `/__health?t=${TOKEN}`)
    expect(ok.status).toBe(200)
    expect(JSON.parse(ok.body)).toEqual({ ok: true, app: 'dsh-pin-gate' })

    const bad = await request(gatePort, '/__health?t=wrong')
    expect(bad.status).toBe(403)
    const none = await request(gatePort, '/__health')
    expect(none.status).toBe(403)
  })

  it('R33: with no PIN set the page only guides, never accepts a first PIN', async () => {
    await startGate()
    const page = await request(gatePort, '/')
    expect(page.status).toBe(200)
    expect(page.body).toContain('访问码尚未设置')
    expect(page.body).toContain('尚未设置访问码')
    // POST /__pin with anything must NOT authenticate when no PIN stored
    const attempt = await request(gatePort, '/__pin', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pin=1234' })
    expect(attempt.body).toContain('PIN 错误')
  })

  it('R17: wrong-PIN lockout triggers and the owner can resetLock', async () => {
    await startGate()
    gate.setPin('1234')
    for (let i = 0; i < 5; i++) {
      await request(gatePort, '/__pin', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pin=0000' })
    }
    expect(gate.status().locked).toBe(true)
    gate.resetLock()
    expect(gate.status().locked).toBe(false)
  })

  it('authed request is proxied and upstream receives the companion token header', async () => {
    await startGate()
    gate.setPin('1234')
    const login = await request(gatePort, '/__pin', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pin=1234' })
    expect(login.status).toBe(303)
    const rawCookie = String(login.headers['set-cookie'])
    // R16: cookie carries Secure (tunnel is always HTTPS)
    expect(rawCookie).toContain('Secure')
    expect(rawCookie).toContain('HttpOnly')
    expect(rawCookie).toContain('SameSite=Strict')
    const cookie = rawCookie.split(';')[0]
    const got = await request(gatePort, '/phn/api/sessions', { headers: { cookie } })
    expect(got.status).toBe(200)
    expect(upstreamSeen.at(-1)?.path).toBe('/phn/api/sessions')
    expect(upstreamSeen.at(-1)?.token).toBe(TOKEN)
  })

  it('R34: allowFullApp=false refuses non-/phn paths and redirects / to /phn', async () => {
    await startGate(false)
    gate.setPin('1234')
    const login = await request(gatePort, '/__pin', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pin=1234' })
    const cookie = String(login.headers['set-cookie']).split(';')[0]
    const blocked = await request(gatePort, '/api/sessions', { headers: { cookie } })
    expect(blocked.status).toBe(403)
    expect(blocked.body).toContain('allowFullApp is off')
    const root = await request(gatePort, '/', { headers: { cookie } })
    expect(root.status).toBe(302)
    expect(String(root.headers.location)).toBe('/phn')
    // /phn still fine
    const phn = await request(gatePort, '/phn/api/sessions', { headers: { cookie } })
    expect(phn.status).toBe(200)
  })

  it('R34: allowFullApp=true proxies the full web UI path', async () => {
    await startGate(true)
    gate.setPin('1234')
    const login = await request(gatePort, '/__pin', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pin=1234' })
    const cookie = String(login.headers['set-cookie']).split(';')[0]
    const got = await request(gatePort, '/api/sessions', { headers: { cookie } })
    expect(got.status).toBe(200)
    expect(upstreamSeen.at(-1)?.path).toBe('/api/sessions')
  })

  it('pair mint is loopback JSON and requires PIN', async () => {
    await startGate()
    const noPin = await request(gatePort, '/__pair/mint', { method: 'POST' })
    expect(noPin.status).toBe(200)
    expect(JSON.parse(noPin.body).ok).toBe(false)
    gate.setPin('1234')
    const minted = await request(gatePort, '/__pair/mint', { method: 'POST' })
    const body = JSON.parse(minted.body)
    expect(body.ok).toBe(true)
    expect(body.url).toMatch(/\/__pair\?t=/)
    const t = new URL(body.url).searchParams.get('t')!
    const used = await request(gatePort, `/__pair?t=${t}`)
    expect(used.status).toBe(200)
    expect(used.body).toContain('绑定成功')
    expect(used.body).not.toContain('请输入访问密码')
    expect(String(used.headers['set-cookie'])).toContain('dsh_device=')
  })

  it('un-authed request is never proxied (PIN required first)', async () => {
    await startGate()
    gate.setPin('1234')
    const got = await request(gatePort, '/phn/api/sessions')
    expect(got.status).toBe(200) // renders the PIN page
    expect(got.body).toContain('PIN')
    expect(upstreamSeen.length).toBe(0)
  })
})
