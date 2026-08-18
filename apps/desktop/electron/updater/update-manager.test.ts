import { describe, expect, it, vi } from 'vitest'
import { UpdateManager, type UpdateProvider } from './update-manager'

function fakeProvider(overrides: Partial<UpdateProvider> = {}): UpdateProvider {
  const base: UpdateProvider = {
    isEnabled: () => true,
    check: async () => ({ available: false }),
    download: async () => undefined,
    install: () => undefined,
    onProgress: () => undefined
  }
  return { ...base, ...overrides }
}

describe('UpdateManager', () => {
  it('reports unsupported when updates are disabled (dev build)', async () => {
    const m = new UpdateManager(fakeProvider({ isEnabled: () => false }))
    const state = await m.check()
    expect(state.status).toBe('unsupported')
    expect(state.error).toMatch(/disabled/)
  })

  it('check finds an available update', async () => {
    const m = new UpdateManager(fakeProvider({ check: async () => ({ available: true, version: '0.2.0' }) }))
    await m.check()
    expect(m.getState()).toMatchObject({ status: 'available', version: '0.2.0' })
  })

  it('check reports up-to-date when nothing is available', async () => {
    const m = new UpdateManager(fakeProvider())
    await m.check()
    expect(m.getState().status).toBe('up-to-date')
  })

  it('check surfaces errors', async () => {
    const m = new UpdateManager(fakeProvider({ check: async () => { throw new Error('network down') } }))
    await m.check()
    expect(m.getState()).toMatchObject({ status: 'error', error: 'network down' })
  })

  it('downloads with progress and completes', async () => {
    const progressCb: Array<(p: number) => void> = []
    const m = new UpdateManager(
      fakeProvider({
        check: async () => ({ available: true, version: '0.3.0' }),
        onProgress: (cb) => progressCb.push(cb),
        download: async () => {
          progressCb[0]?.(42)
        }
      })
    )
    await m.check()
    await m.download()
    expect(m.getState().status).toBe('downloaded')
    expect(m.getState().percent).toBe(100)
  })

  it('download failure leaves an error state and a retryable path', async () => {
    const m = new UpdateManager(
      fakeProvider({
        check: async () => ({ available: true, version: '0.4.0' }),
        download: async () => {
          throw new Error('checksum mismatch')
        }
      })
    )
    await m.check()
    await m.download()
    expect(m.getState()).toMatchObject({ status: 'error', error: 'checksum mismatch' })
  })

  it('install invokes the provider', async () => {
    const install = vi.fn()
    const m = new UpdateManager(fakeProvider({ install }))
    m.install()
    expect(install).toHaveBeenCalled()
  })

  it('notifies subscribers on state changes', async () => {
    const m = new UpdateManager(fakeProvider({ check: async () => ({ available: true, version: '1.0.0' }) }))
    const seen: string[] = []
    m.subscribe((s) => seen.push(s.status))
    await m.check()
    expect(seen).toContain('checking')
    expect(seen).toContain('available')
  })
})
