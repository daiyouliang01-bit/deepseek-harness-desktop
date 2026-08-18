import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:net'
import { isPortFree, findFreePort } from './port-probe'

describe('isPortFree', () => {
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()))
      server = null
    }
  })

  it('returns true when the port is free', async () => {
    // find a port, release it, then confirm it reads as free
    const port = await findFreePort(49152, 10)
    expect(port).not.toBeNull()
    expect(await isPortFree(port as number)).toBe(true)
  })

  it('returns false when the port is occupied', async () => {
    server = createServer()
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    expect(port).toBeGreaterThan(0)
    expect(await isPortFree(port)).toBe(false)
  })
})

describe('findFreePort', () => {
  it('returns a port within the requested range', async () => {
    const port = await findFreePort(49_152, 20)
    expect(port).not.toBeNull()
    expect(port as number).toBeGreaterThanOrEqual(49_152)
    expect(port as number).toBeLessThan(49_152 + 20)
  })

  it('returns null when the range is exhausted', async () => {
    // occupy the whole range then ask for a free one
    const servers: Server[] = []
    for (let i = 0; i < 3; i++) {
      const s = createServer()
      await new Promise<void>((resolve) => s.listen(49_300 + i, '127.0.0.1', () => resolve()))
      servers.push(s)
    }
    const port = await findFreePort(49_300, 3)
    expect(port).toBeNull()
    await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
  })
})
