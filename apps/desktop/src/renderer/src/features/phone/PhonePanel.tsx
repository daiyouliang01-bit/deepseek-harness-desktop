import type { Tokens } from '@dshd/ui'
import { useCallback, useEffect, useState } from 'react'
import type { TunnelStatus } from '@electron/preload/index'

interface PhonePanelProps {
  tokens: Tokens
}

const PHASE_LABEL: Record<string, string> = {
  idle: '未启动',
  starting: '启动中…',
  active: '已就绪',
  installing: '安装 cloudflared…'
}

/** Task 7.3 — PIN set/status form for the phone-access gate. */
function PinForm({ tokens }: { tokens: Tokens }): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [enabled, setEnabled] = useState(false)
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const res = await window.desktop.pinStatus()
    if (res.ok && res.value) setEnabled(res.value.enabled)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(async () => {
    if (pin.length < 4) {
      setMsg('PIN 至少 4 位')
      return
    }
    if (pin !== confirm) {
      setMsg('两次输入不一致')
      return
    }
    setBusy(true)
    setMsg(null)
    const res = await window.desktop.pinSet(pin)
    setBusy(false)
    if (res.ok) {
      setMsg('已保存')
      setPin('')
      setConfirm('')
      void refresh()
    } else {
      setMsg(res.error ?? '保存失败')
    }
  }, [pin, confirm, refresh])

  return (
    <div style={{ marginTop: space.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
        <span style={{ color: colors.text, fontSize: font.sizeSm }}>
          {enabled ? '✅ 已设置' : '⚠ 未设置(手机无法访问)'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: space.sm, marginBottom: space.sm }}>
        <input
          type="password"
          placeholder="新 PIN(至少 4 位)"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          style={{ flex: 1, padding: '8px 10px', borderRadius: radius.sm, border: `1px solid ${colors.border}`, background: colors.surfaceAlt, color: colors.text }}
        />
        <input
          type="password"
          placeholder="确认 PIN"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={{ flex: 1, padding: '8px 10px', borderRadius: radius.sm, border: `1px solid ${colors.border}`, background: colors.surfaceAlt, color: colors.text }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
        <button className="mini" disabled={busy} onClick={() => void save()}>
          {busy ? '保存中…' : enabled ? '更新 PIN' : '设置 PIN'}
        </button>
        {msg && <span style={{ color: colors.accent, fontSize: font.sizeSm }}>{msg}</span>}
      </div>
    </div>
  )
}

/**
 * Task 7.2 — Phone access panel: Cloudflare quick-tunnel status + control.
 * The tunnel is managed by the @dshd/phone-sync plugin inside the dsh
 * runtime; this panel drives it over IPC (main proxies the HTTP routes).
 */
export function PhonePanel({ tokens }: PhonePanelProps): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [status, setStatus] = useState<TunnelStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    const res = await window.desktop.phoneStatus()
    if (res.ok && res.value) {
      setStatus(res.value)
      setError(null)
    } else {
      setError(res.error ?? '无法读取隧道状态')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [refresh])

  const start = useCallback(async () => {
    setBusy(true)
    const res = await window.desktop.phoneStart()
    if (res.ok && res.value) setStatus(res.value)
    else setError(res.error ?? '启动失败')
    setBusy(false)
  }, [])

  const stop = useCallback(async () => {
    setBusy(true)
    const res = await window.desktop.phoneStop()
    if (res.ok && res.value) setStatus(res.value)
    else setError(res.error ?? '停止失败')
    setBusy(false)
  }, [])

  const copyUrl = useCallback(async () => {
    if (!status?.url) return
    try {
      await navigator.clipboard.writeText(status.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }, [status])

  const active = status?.phase === 'active'

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <h2 style={{ color: colors.text, fontSize: 22, margin: 0 }}>📱 手机访问</h2>
      <p style={{ color: colors.textMuted, fontSize: font.sizeSm, marginTop: space.xs }}>
        通过 Cloudflare 隧道把桌面端实时同步到手机浏览器（移动端优化页面，支持发消息）。
      </p>

      <div
        style={{
          marginTop: space.lg,
          padding: space.lg,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.md
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: colors.text, fontSize: font.sizeMd }}>隧道状态</div>
          <span
            style={{
              color: active ? colors.success : colors.warn,
              fontWeight: 600,
              fontSize: font.sizeSm
            }}
          >
            {status ? PHASE_LABEL[status.phase] ?? status.phase : '…'}
          </span>
        </div>

        {error && <p style={{ color: colors.danger, fontSize: font.sizeSm, marginTop: space.sm }}>⚠ {error}</p>}

        {active && status.url && (
          <div style={{ marginTop: space.lg }}>
            <div style={{ color: colors.textMuted, fontSize: font.sizeSm, marginBottom: space.xs }}>手机访问地址</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: space.sm,
                background: colors.surfaceAlt,
                padding: `${space.sm}px ${space.md}px`,
                borderRadius: radius.sm
              }}
            >
              <code
                style={{
                  flex: 1,
                  color: colors.accent,
                  fontSize: font.sizeMd,
                  wordBreak: 'break-all',
                  fontFamily: font.mono
                }}
              >
                {status.url}
              </code>
              <button
                className="mini"
                onClick={() => void copyUrl()}
                style={{ flexShrink: 0 }}
              >
                {copied ? '✓ 已复制' : '复制'}
              </button>
            </div>
            <p style={{ color: colors.textMuted, fontSize: font.sizeSm, marginTop: space.sm }}>
              手机打开该地址即可访问（若配置了 Cloudflare Access，会先要求登录授权）。
            </p>
          </div>
        )}

        {status?.phase === 'idle' && (
          <p style={{ color: colors.textMuted, fontSize: font.sizeSm, marginTop: space.sm }}>
            启动隧道后，手机可通过生成的 trycloudflare.com 地址访问。
          </p>
        )}

        <div style={{ display: 'flex', gap: space.sm, marginTop: space.lg }}>
          <button className="mini" disabled={busy || active} onClick={() => void start()}>
            {busy ? '处理中…' : '启动隧道'}
          </button>
          <button className="mini danger" disabled={busy || !active} onClick={() => void stop()}>
            停止
          </button>
        </div>
      </div>

      <div style={{ marginTop: space.lg, padding: space.lg, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.md }}>
        <div style={{ color: colors.text, fontSize: font.sizeMd }}>访问 PIN</div>
        <p style={{ color: colors.textMuted, fontSize: font.sizeSm, marginTop: space.xs }}>
          手机通过隧道访问前需输入 PIN(至少 4 位)。公网暴露 DSH 有远程执行能力,请设置足够长的 PIN 并定期更换。
        </p>
        <PinForm tokens={tokens} />
      </div>

      <div style={{ marginTop: space.lg, padding: space.lg, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.md }}>
        <div style={{ color: colors.text, fontSize: font.sizeMd }}>说明</div>
        <ul style={{ color: colors.textMuted, fontSize: font.sizeSm, lineHeight: 1.7, margin: `${space.sm}px 0 0`, paddingLeft: space.lg }}>
          <li>隧道由桌面端内嵌的 phone-sync 插件管理，退出应用时自动关闭。</li>
          <li>移动端页面为优化视图（会话列表 / 详情 / 发消息 / 实时状态），路由在 <code>/phn</code>。</li>
          <li>手机与电脑需都能访问外网（隧道经 Cloudflare 中转）。</li>
        </ul>
      </div>
    </div>
  )
}
