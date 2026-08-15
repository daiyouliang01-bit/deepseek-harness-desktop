import { useCallback, useEffect, useState } from 'react'
import type { RuntimeStatus } from '@electron/runtime/runtime-types'
import { AppShell } from './features/layout/AppShell'

type Screen = 'loading' | 'recovery' | 'shell'

/**
 * Task 1.3 + 3.1 shell screen.
 * - loading: shown while the Harness runtime boots
 * - recovery: runtime failed/stopped → retry / restart / open logs / quit
 * - shell: custom ChatGPT/Claude-style shell (Task 3.1), reachable via the
 *   diagnostic toggle; "Open official UI" swaps back to the official Web UI
 * When the runtime is ready, the main process normally loads the official Web
 * UI into this window, replacing this view entirely.
 */
export default function App(): React.JSX.Element {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [version, setVersion] = useState('')
  const [screen, setScreen] = useState<Screen>('loading')

  useEffect(() => {
    const desktop = window.desktop
    void desktop.getVersion().then(setVersion)
    void desktop.getRuntimeStatus().then(setStatus)
    const unsubscribe = desktop.onRuntimeStatus(setStatus)
    return unsubscribe
  }, [])

  // App menu "View → Custom Shell" (Task 1.5/3.1) swaps the window to the shell view.
  useEffect(() => window.desktop.onOpenShell(() => setScreen('shell')), [])

  // Follow runtime state unless the user explicitly opened the custom shell.
  useEffect(() => {
    if (screen === 'shell') return
    if (!status || status.state === 'starting' || status.state === 'idle') setScreen('loading')
    else setScreen('recovery')
  }, [status, screen])

  const onRetry = useCallback(() => {
    void window.desktop.restartRuntime().then(setStatus)
  }, [])
  const onRestart = useCallback(() => {
    void window.desktop.restartRuntime().then(setStatus)
  }, [])
  const onStop = useCallback(() => {
    void window.desktop.stopRuntime().then(setStatus)
  }, [])
  const onOpenLogs = useCallback(() => {
    void window.desktop.openLogs()
  }, [])
  const onQuit = useCallback(() => {
    void window.desktop.quit()
  }, [])
  const onOpenShell = useCallback(() => setScreen('shell'), [])
  const onBackToOfficial = useCallback(() => {
    void window.desktop.openOfficialUI().then((res) => {
      if (!res.ok) {
        // runtime not ready — the status event will drive the screen
        setScreen('recovery')
      }
    })
  }, [])

  if (screen === 'shell') {
    return (
      <AppShell
        status={status}
        onRestart={onRestart}
        onStop={onStop}
        onOpenLogs={onOpenLogs}
        onBackToOfficial={onBackToOfficial}
      />
    )
  }

  if (screen === 'loading') {
    return (
      <div className="shell">
        <div className="card">
          <h1>DeepSeek Harness Desktop</h1>
          <p className="muted">Starting local Harness runtime…</p>
          <div className="spinner" aria-label="loading" />
          <p className="muted small">{version && `v${version}`}</p>
          <button className="ghost" onClick={onOpenShell}>
            Open custom shell (preview)
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="card">
        <h1>Runtime unavailable</h1>
        <p className="muted">
          {status?.state === 'stopped'
            ? 'The Harness runtime is stopped.'
            : status?.lastError
              ? status.lastError
              : 'The Harness runtime failed to start.'}
        </p>
        <dl className="meta">
          <div>
            <dt>state</dt>
            <dd>{status?.state ?? 'unknown'}</dd>
          </div>
          {status?.pid !== undefined && (
            <div>
              <dt>pid</dt>
              <dd>{status.pid}</dd>
            </div>
          )}
          {status?.ready && (
            <div>
              <dt>url</dt>
              <dd>{status.ready.url}</dd>
            </div>
          )}
        </dl>
        <div className="actions">
          <button onClick={onRetry}>Retry</button>
          <button onClick={onRestart}>Restart runtime</button>
          <button onClick={onStop}>Stop</button>
          <button onClick={onOpenLogs}>Open logs</button>
          <button onClick={onOpenShell}>Custom shell</button>
          <button onClick={onQuit}>Quit</button>
        </div>
      </div>
    </div>
  )
}
