import type { Tokens } from '@dshd/ui'
import { useCallback, useEffect, useState } from 'react'
import type { RuntimeStatus } from '@electron/runtime/runtime-types'
import type { UpdateState } from '@electron/updater/update-manager'

interface SettingsPanelProps {
  tokens: Tokens
  status: RuntimeStatus | null
  onRestart: () => void
  onStop: () => void
  onOpenLogs: () => void
  onBackToOfficial: () => void
}

function UpdateSection({ tokens }: { tokens: Tokens }): React.JSX.Element {
  const [state, setState] = useState<UpdateState | null>(null)
  const { colors, space } = tokens

  useEffect(() => {
    void window.desktop.updateGetState().then(setState)
    return window.desktop.onUpdateState(setState)
  }, [])

  return (
    <section style={{ background: colors.surface, borderRadius: 10, padding: space.md, marginBottom: space.md }}>
      <h3 style={{ color: colors.text, fontSize: 18, margin: `0 0 ${space.sm}px` }}>Updates</h3>
      <div style={{ color: colors.textMuted, fontSize: 14, marginBottom: space.sm }}>
        {state?.status === 'available' && `New version ${state.version} available`}
        {state?.status === 'downloading' && `Downloading… ${Math.round(state.percent ?? 0)}%`}
        {state?.status === 'downloaded' && 'Downloaded — restart to install'}
        {state?.status === 'up-to-date' && 'Up to date'}
        {state?.status === 'unsupported' && 'Updates unavailable (development build)'}
        {state?.status === 'error' && `Update error: ${state.error}`}
        {!state && '…'}
      </div>
      <div style={{ display: 'flex', gap: space.sm }}>
        <button onClick={() => void window.desktop.updateCheck()}>Check for updates</button>
        {state?.status === 'available' && (
          <button onClick={() => void window.desktop.updateDownload()}>Download</button>
        )}
        {state?.status === 'downloaded' && (
          <button onClick={() => void window.desktop.updateInstall()}>Restart & install</button>
        )}
      </div>
    </section>
  )
}

function DesktopSection({ tokens }: { tokens: Tokens }): React.JSX.Element {
  const [autolaunch, setAutolaunch] = useState<boolean | null>(null)
  const { colors, space } = tokens

  useEffect(() => {
    void window.desktop.autolaunchGet().then((r) => setAutolaunch(r.enabled))
  }, [])

  return (
    <section style={{ background: colors.surface, borderRadius: 10, padding: space.md, marginBottom: space.md }}>
      <h3 style={{ color: colors.text, fontSize: 18, margin: `0 0 ${space.sm}px` }}>Desktop</h3>
      <label style={{ display: 'flex', alignItems: 'center', gap: space.sm, color: colors.textMuted, fontSize: 14, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={autolaunch === true}
          onChange={(e) => {
            const next = e.target.checked
            setAutolaunch(next)
            void window.desktop.autolaunchSet(next)
          }}
        />
        开机时自动启动（登录后静默驻留托盘）
      </label>
      {autolaunch === null && <span style={{ color: colors.textMuted, fontSize: 12 }}>…</span>}
    </section>
  )
}

/** 数据目录 — 多实例隔离：与 Web GUI(3080) 分开数据避免会话日志互相写坏。 */
function DataDirSection({ tokens }: { tokens: Tokens }): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [current, setCurrent] = useState<string | null>(null)
  const [defaultHome, setDefaultHome] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.desktop.dshHomeGet().then((res) => {
      if (res.ok && res.value) {
        setCurrent(res.value)
        setDraft(res.value)
        setDefaultHome(res.default)
      }
    })
  }, [])

  const save = useCallback(async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await window.desktop.dshHomeSet(draft.trim())
      if (res.ok) {
        setCurrent(res.value ?? draft.trim())
        setMsg(res.restartRequired ? `已保存 — 重启桌面壳后生效（当前数据目录：${res.value}）` : '已保存')
      } else {
        setMsg(res.error ?? '保存失败')
      }
    } finally {
      setBusy(false)
    }
  }, [draft])

  return (
    <section style={{ background: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.md }}>
      <h3 style={{ color: colors.text, fontSize: font.sizeLg, margin: `0 0 ${space.sm}px` }}>数据目录</h3>
      <p style={{ color: colors.textMuted, fontSize: font.sizeSm, margin: `0 0 ${space.sm}px`, lineHeight: 1.6 }}>
        当前：<code style={{ fontFamily: font.mono, color: colors.text }}>{current ?? '…'}</code>
        {defaultHome && current !== defaultHome && (
          <span style={{ display: 'block', marginTop: 4 }}>默认（共享 Web GUI）：{defaultHome}</span>
        )}
        {current === defaultHome && (
          <span style={{ display: 'block', marginTop: 4 }}>与 Web GUI（3080）共享同一数据目录。同时运行两个实例会互相写坏会话日志（历史打不开）。</span>
        )}
      </p>
      <div style={{ display: 'flex', gap: space.sm }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="/Users/you/.dsh-desktop（独立目录）"
          style={{
            flex: 1,
            padding: `${space.sm}px ${space.md}px`,
            borderRadius: radius.sm,
            background: colors.surfaceAlt,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            fontSize: font.sizeMd,
            fontFamily: font.mono
          }}
        />
        <button onClick={() => void save()} disabled={busy || draft.trim() === current}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
      {msg && <p style={{ color: msg.startsWith('已保存') ? colors.success : colors.danger, fontSize: font.sizeSm, margin: `${space.sm}px 0 0` }}>{msg}</p>}
    </section>
  )
}

/**
 * Task 3.1 settings panel. Runtime controls + model/provider placeholders.
 * API key entry is intentionally NOT in the renderer (safeStorage lives in
 * the main process — Task 3.5 adds the onboarding/key UI via IPC).
 */
export function SettingsPanel({
  tokens,
  status,
  onRestart,
  onStop,
  onOpenLogs,
  onBackToOfficial
}: SettingsPanelProps): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${space.sm}px 0`,
    borderBottom: `1px solid ${colors.border}`
  }
  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ color: colors.text, fontSize: font.sizeXl, marginBottom: space.md }}>Settings</h2>

      <section style={{ background: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.md }}>
        <h3 style={{ color: colors.text, fontSize: font.sizeLg, margin: `0 0 ${space.sm}px` }}>Runtime</h3>
        <div style={row}>
          <span style={{ color: colors.textMuted }}>State</span>
          <span style={{ color: colors.text, fontFamily: font.mono }}>{status?.state ?? 'unknown'}</span>
        </div>
        {status?.pid !== undefined && (
          <div style={row}>
            <span style={{ color: colors.textMuted }}>PID</span>
            <span style={{ color: colors.text, fontFamily: font.mono }}>{status.pid}</span>
          </div>
        )}
        {status?.ready && (
          <div style={row}>
            <span style={{ color: colors.textMuted }}>URL</span>
            <span style={{ color: colors.text, fontFamily: font.mono, fontSize: font.sizeSm }}>{status.ready.url}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: space.sm, marginTop: space.md }}>
          <button onClick={onRestart}>Restart runtime</button>
          <button onClick={onStop}>Stop</button>
          <button onClick={onOpenLogs}>Open logs</button>
        </div>
      </section>

      <section style={{ background: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.md }}>
        <h3 style={{ color: colors.text, fontSize: font.sizeLg, margin: `0 0 ${space.sm}px` }}>Model & Provider</h3>
        <div style={row}>
          <span style={{ color: colors.textMuted }}>Provider</span>
          <span style={{ color: colors.text }}>deepseek-official (managed by runtime)</span>
        </div>
        <div style={row}>
          <span style={{ color: colors.textMuted }}>Model</span>
          <span style={{ color: colors.text }}>deepseek-v4-flash (runtime default)</span>
        </div>
        <div style={row}>
          <span style={{ color: colors.textMuted }}>API key</span>
          <span style={{ color: colors.success }}>managed in OS keychain (main process)</span>
        </div>
      </section>

      <UpdateSection tokens={tokens} />
      <DesktopSection tokens={tokens} />
      <DataDirSection tokens={tokens} />

      <section style={{ background: colors.surface, borderRadius: radius.md, padding: space.md }}>
        <h3 style={{ color: colors.text, fontSize: font.sizeLg, margin: `0 0 ${space.sm}px` }}>Official Web UI</h3>
        <p style={{ color: colors.textMuted, fontSize: font.sizeSm, margin: `0 0 ${space.sm}px` }}>
          The official Harness Web UI remains available behind this diagnostic toggle until this shell reaches MVP parity.
        </p>
        <button onClick={onBackToOfficial}>Open official UI</button>
      </section>
    </div>
  )
}
