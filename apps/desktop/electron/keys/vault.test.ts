import { describe, expect, it, vi } from 'vitest'
import { KeyVault, type VaultCrypto } from './vault'

function fakeCrypto(): VaultCrypto {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => ({ toString: () => Buffer.from(`enc:${plain}`).toString('base64') }),
    decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, '')
  }
}

function memStore(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k)
  }
}

describe('KeyVault', () => {
  it('stores and retrieves keys encrypted', () => {
    const store = memStore()
    const vault = new KeyVault(store, fakeCrypto())
    vault.setKey('deepseek', 'sk-secret-123')
    const stored = store.getItem('dshd:key:deepseek') as string
    expect(Buffer.from(stored, 'base64').toString('utf8')).toContain('enc:') // encrypted at rest, not plaintext
    expect(stored).not.toContain('sk-secret-123')
    expect(vault.getKey('deepseek')).toBe('sk-secret-123')
  })

  it('refuses to store when encryption is unavailable', () => {
    const vault = new KeyVault(memStore(), {
      ...fakeCrypto(),
      isEncryptionAvailable: () => false
    })
    expect(() => vault.setKey('deepseek', 'x')).toThrow(/keychain unavailable/)
  })

  it('removes keys', () => {
    const vault = new KeyVault(memStore(), fakeCrypto())
    vault.setKey('deepseek', 'sk-x')
    vault.removeKey('deepseek')
    expect(vault.getKey('deepseek')).toBeNull()
  })

  it('lists providers with masked keys, never plaintext', () => {
    const vault = new KeyVault(memStore(), fakeCrypto())
    vault.setKey('deepseek', 'sk-abcdefghijklmnop')
    const records = vault.listKeys(['deepseek', 'anthropic'])
    expect(records[0]).toMatchObject({ provider: 'deepseek', configured: true })
    expect(records[0].masked).toContain('…')
    expect(records[0].masked).not.toContain('sk-abcdef')
    expect(records[1]).toMatchObject({ provider: 'anthropic', configured: false, masked: '' })
  })

  it('validates deepseek keys against the live API and marks validated', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const store = memStore()
    const vault = new KeyVault(store, fakeCrypto())
    const res = await vault.validateKey('deepseek', 'sk-good')
    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.anything())
    expect(store.getItem('dshd:key:deepseek:validated')).toBeTruthy()
  })

  it('reports invalid keys and unsupported providers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }))
    const vault = new KeyVault(memStore(), fakeCrypto())
    const bad = await vault.validateKey('deepseek', 'sk-bad')
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/401/)
    const other = await vault.validateKey('anthropic', 'sk-x')
    expect(other.ok).toBe(false)
    expect(other.error).toMatch(/unsupported/)
  })
})
