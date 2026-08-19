import { Readable } from 'node:stream'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHandlers } from '../lib/routes.js'

function mockResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers || {}
    },
    end(body = '') {
      this.body = body
    },
  }
}

function request(method, url, headers = {}, body) {
  const req = Readable.from(body !== undefined ? [Buffer.from(body)] : [])
  req.method = method
  req.url = url
  req.headers = headers
  return req
}

describe('routes', () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  // profile dir may not exist — collectInventory must still 200 with empty lists
  const handlers = createHandlers({
    profile: 'web',
    dshHome,
    homedir: mkdtempSync(join(tmpdir(), 'home-')),
    fetcher: async () => {
      throw new Error('list must not fetch')
    },
  })

  it('GET list is loopback-only and does not touch the network', async () => {
    const denied = mockResponse()
    await handlers.list(request('GET', '/dsh-installed/list', { host: 'example.com' }), denied)
    assert.equal(denied.status, 403)

    const ok = mockResponse()
    await handlers.list(request('GET', '/dsh-installed/list', { host: '127.0.0.1:35880' }), ok)
    assert.equal(ok.status, 200)
    const body = JSON.parse(ok.body)
    assert.ok(Array.isArray(body.plugins))
    assert.ok(Array.isArray(body.skills))
  })

  it('POST check-updates requires same-origin loopback', async () => {
    const denied = mockResponse()
    await handlers.check(request('POST', '/dsh-installed/check-updates', {
      host: '127.0.0.1:35880',
      origin: 'https://evil.example',
    }), denied)
    assert.equal(denied.status, 403)

    const missingOrigin = mockResponse()
    await handlers.check(request('POST', '/dsh-installed/check-updates', {
      host: '127.0.0.1:35880',
    }, '{}'), missingOrigin)
    assert.equal(missingOrigin.status, 403)

    const httpsOrigin = mockResponse()
    await handlers.check(request('POST', '/dsh-installed/check-updates', {
      host: '127.0.0.1:35880',
      origin: 'https://127.0.0.1:35880',
    }, '{}'), httpsOrigin)
    assert.equal(httpsOrigin.status, 403)

    const ok = mockResponse()
    await handlers.check(request('POST', '/dsh-installed/check-updates', {
      host: '127.0.0.1:35880',
      origin: 'http://127.0.0.1:35880',
    }, '{}'), ok)
    assert.equal(ok.status, 200)
  })

  it('POST apply-updates requires same-origin loopback', async () => {
    const denied = mockResponse()
    await handlers.apply(request('POST', '/dsh-installed/apply-updates', {
      host: '127.0.0.1:35880',
      origin: 'https://evil.example',
    }, '{"mode":"local"}'), denied)
    assert.equal(denied.status, 403)
  })

  it('accepts IPv6 loopback Host hostname ::1', async () => {
    const ok = mockResponse()
    await handlers.list(request('GET', '/dsh-installed/list', { host: '[::1]:35880' }), ok)
    assert.equal(ok.status, 200)
  })
})
