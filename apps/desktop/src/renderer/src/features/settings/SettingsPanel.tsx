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

/** 数据目录 — 写死与 3080 隔离：默认 ~/.dsh-desktop，禁止指回 ~/.dsh。 */
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
        {defaultHome && (
          <span style={{ display: 'block', marginTop: 4 }}>
            默认独立目录：{defaultHome}。与 3080（~/.dsh）物理隔离，桌面改动不会同步过去。
          </span>
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

// P2 — real diagnostics (external review item #5): the settings page shows
// what is ACTUALLY running (versions, pid, port, data dir), not hardcoded
// copy that drifts from reality.
interface Diagnostics {
  appVersion: string
  packaged: boolean
  electron: string
  node: string
  platform: string
  dshPinnedVersion: string | null
  dshHome: string
  profile: string
  preferredPort: number
  port3080InUse: boolean | null
  runtime: {
    state: string
    pid: number | null
    url: string | null
    port: number | null
    startedAt: number | null
    lastError: string | null
  }
}

function DiagnosticsSection({ tokens }: { tokens: Tokens }): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [diag, setDiag] = useState<Diagnostics | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void window.desktop.getDiagnostics().then((d) => setDiag(d as Diagnostics))
  }, [])
  const copy = useCallback(() => {
    if (!diag) return
    void navigator.clipboard.writeText(JSON.stringify(diag, null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [diag])
  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    padding: `${space.sm}px 0`,
    borderBottom: `1px solid ${colors.border}`
  }
  const kv = (k: string, v: React.ReactNode) => (
    <div key={k} style={row}>
      <span style={{ color: colors.textMuted, flexShrink: 0 }}>{k}</span>
      <span style={{ color: colors.text, fontFamily: font.mono, fontSize: font.sizeSm, wordBreak: 'break-all', textAlign: 'right' }}>{v}</span>
    </div>
  )
  return (
    <section style={{ background: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.md }}>
      <h3 style={{ color: colors.text, fontSize: font.sizeLg, margin: `0 0 ${space.sm}px` }}>诊断信息</h3>
      {diag === null ? (
        <p style={{ color: colors.textMuted, fontSize: font.sizeSm, margin: 0 }}>加载中…</p>
      ) : (
        <>
          {kv('应用版本', `${diag.appVersion}（${diag.packaged ? '打包' : '开发'}）`)}
          {kv('Electron / Node', `${diag.electron} / ${diag.node}`)}
          {kv('Runtime 状态', diag.runtime.state)}
          {diag.runtime.pid !== null && kv('Runtime PID', String(diag.runtime.pid))}
          {diag.runtime.url !== null && kv('实际地址', diag.runtime.url)}
          {kv('dsh 版本（pin）', diag.dshPinnedVersion ?? '未知')}
          {kv('数据目录', diag.dshHome)}
          {kv('Profile', diag.profile)}
          {kv('首选端口', String(diag.preferredPort))}
          {kv(':3080 独立实例', diag.port3080InUse === null ? '未知' : diag.port3080InUse ? '检测到在运行' : '未检测到')}
          {diag.runtime.lastError && kv('最近错误', diag.runtime.lastError)}
          <div style={{ display: 'flex', gap: space.sm, marginTop: space.md }}>
            <button onClick={copy}>{copied ? '已复制 ✓' : '复制诊断信息'}</button>
          </div>
          <p style={{ color: colors.textMuted, fontSize: font.sizeSm, margin: `${space.md}px 0 0` }}>
            模型路由由官方 Web UI 的模型选择器决定（会话级），设置页不再展示固定模型。
          </p>
        </>
      )}
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

      <DiagnosticsSection tokens={tokens} />

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
