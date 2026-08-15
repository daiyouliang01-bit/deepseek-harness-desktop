import type { Tokens } from '@dshd/ui'
import { useCallback, useEffect, useState } from 'react'
import type { KeyRecord } from '@electron/keys/vault'

interface OnboardingProps {
  tokens: Tokens
  onComplete: () => void
}

/**
 * Task 3.5 first-run onboarding: select provider → enter API key → validate.
 * The key itself is sent to the main process (safeStorage) and never stored
 * in renderer state beyond the input; only the validation result returns.
 */
export function Onboarding({ tokens, onComplete }: OnboardingProps): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [keys, setKeys] = useState<KeyRecord[]>([])
  const [provider, setProvider] = useState('deepseek')
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    void window.desktop.listKeys().then(setKeys)
  }, [])

  const onSave = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.desktop.setKey(provider, keyInput)
      if (!res.ok) {
        setError(res.error ?? 'failed to save key')
        return
      }
      setDone(true)
      const fresh = await window.desktop.listKeys()
      setKeys(fresh)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [provider, keyInput])

  const onSkip = useCallback(() => {
    onComplete()
  }, [onComplete])

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: 48 }}>
      <h2 style={{ color: colors.text, fontSize: font.sizeXl, marginBottom: space.sm }}>Welcome 👋</h2>
      <p style={{ color: colors.textMuted, fontSize: font.sizeMd, marginBottom: space.lg }}>
        Connect your DeepSeek API key to start using the Harness. The key is encrypted in your OS
        keychain — it never leaves your machine or reaches the UI.
      </p>

      {keys.some((k) => k.configured) && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            padding: space.md,
            marginBottom: space.md
          }}
        >
          <div style={{ color: colors.success, fontSize: font.sizeMd }}>✓ Key already configured</div>
          <button onClick={onSkip} style={{ marginTop: space.sm }}>
            Continue
          </button>
        </div>
      )}

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.md,
          padding: space.lg
        }}
      >
        <label style={{ color: colors.textMuted, fontSize: font.sizeSm, display: 'block', marginBottom: space.xs }}>
          Provider
        </label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          style={{
            width: '100%',
            marginBottom: space.md,
            padding: `${space.sm}px`,
            background: colors.surfaceAlt,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm
          }}
        >
          <option value="deepseek">deepseek-official</option>
        </select>

        <label style={{ color: colors.textMuted, fontSize: font.sizeSm, display: 'block', marginBottom: space.xs }}>
          API key
        </label>
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="sk-…"
          style={{
            width: '100%',
            marginBottom: space.md,
            padding: `${space.sm}px`,
            background: colors.surfaceAlt,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            fontFamily: font.mono
          }}
        />

        {error && (
          <div style={{ color: colors.danger, fontSize: font.sizeSm, marginBottom: space.md }}>⚠ {error}</div>
        )}
        {done && (
          <div style={{ color: colors.success, fontSize: font.sizeSm, marginBottom: space.md }}>
            ✓ Key validated and saved.
          </div>
        )}

        <div style={{ display: 'flex', gap: space.sm }}>
          <button onClick={() => void onSave()} disabled={busy || keyInput.trim().length === 0}>
            {busy ? 'Validating…' : 'Validate & save'}
          </button>
          <button onClick={onSkip} className="ghost">
            Skip for now
          </button>
        </div>
      </div>
    </div>
  )
}
