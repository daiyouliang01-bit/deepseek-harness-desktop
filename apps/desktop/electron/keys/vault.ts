/** Task 3.5 — provider API key vault (main process, safeStorage-backed). */

export interface KeyRecord {
  provider: string
  /** masked display form, e.g. sk-…abcd */
  masked: string
  configured: boolean
  lastValidatedAt?: number
}

/** Injectable encryption boundary (safeStorage in production, fake in tests). */
export interface VaultCrypto {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => { toString: (enc: 'base64') => string }
  decryptString: (buf: Buffer) => string
}

const KEY_PREFIX = 'dshd:key:'

/**
 * safeStorage is only importable inside Electron (the main process). Lazy
 * require keeps this module unit-testable under plain Node (vitest) where
 * `electron` is not loadable.
 */
function electronSafeStorage(): typeof import('electron').safeStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('electron').safeStorage as typeof import('electron').safeStorage
  } catch {
    return null
  }
}

const SAFE_STORAGE_CRYPTO: VaultCrypto = {
  isEncryptionAvailable: () => {
    try {
      return electronSafeStorage()?.isEncryptionAvailable() ?? false
    } catch {
      return false
    }
  },
  encryptString: (plain) => {
    const ss = electronSafeStorage()
    if (!ss) throw new Error('safeStorage unavailable')
    return ss.encryptString(plain)
  },
  decryptString: (buf) => {
    const ss = electronSafeStorage()
    if (!ss) throw new Error('safeStorage unavailable')
    return ss.decryptString(buf)
  }
}

/**
 * Vault keyed by provider. Secrets live in OS-protected storage via
 * safeStorage; they NEVER cross into the renderer (only the masked form
 * and validation status do).
 */
export class KeyVault {
  constructor(
    private readonly store: {
      getItem: (key: string) => string | null
      setItem: (key: string, value: string) => void
      removeItem: (key: string) => void
    },
    private readonly crypto: VaultCrypto = SAFE_STORAGE_CRYPTO
  ) {}

  isEncryptionAvailable(): boolean {
    return this.crypto.isEncryptionAvailable()
  }

  /** Store a provider key (encrypted). */
  setKey(provider: string, key: string): void {
    if (!this.isEncryptionAvailable()) throw new Error('OS keychain unavailable — cannot store API key safely')
    const encrypted = this.crypto.encryptString(key).toString('base64')
    this.store.setItem(KEY_PREFIX + provider, encrypted)
  }

  /** Read a provider key (decrypted). Returns null when absent. */
  getKey(provider: string): string | null {
    const raw = this.store.getItem(KEY_PREFIX + provider)
    if (!raw) return null
    try {
      return this.crypto.decryptString(Buffer.from(raw, 'base64'))
    } catch {
      return null // undecryptable (e.g. keychain lock) → treat as absent
    }
  }

  removeKey(provider: string): void {
    this.store.removeItem(KEY_PREFIX + provider)
  }

  /** List configured providers with masked keys (renderer-safe). */
  listKeys(providers: string[]): KeyRecord[] {
    return providers.map((provider) => {
      const key = this.getKey(provider)
      return {
        provider,
        configured: key !== null,
        masked: key ? maskKey(key) : '',
        lastValidatedAt: this.readValidatedAt(provider) ?? undefined
      }
    })
  }

  markValidated(provider: string): void {
    this.store.setItem(`${KEY_PREFIX}${provider}:validated`, String(Date.now()))
  }

  /** Validate a key with a live API call (main process only). */
  async validateKey(provider: string, key: string): Promise<{ ok: boolean; error?: string }> {
    // Only DeepSeek is supported in v1 (per product scope: not every provider).
    if (provider !== 'deepseek') return { ok: false, error: `unsupported provider: ${provider}` }
    try {
      const res = await fetch('https://api.deepseek.com/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000)
      })
      if (res.ok) {
        this.markValidated(provider)
        return { ok: true }
      }
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'invalid or expired key (401/403)' }
      return { ok: false, error: `validation failed: HTTP ${res.status}` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'network error during validation' }
    }
  }

  private readValidatedAt(provider: string): number | null {
    const raw = this.store.getItem(`${KEY_PREFIX}${provider}:validated`)
    return raw ? Number(raw) : null
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}
