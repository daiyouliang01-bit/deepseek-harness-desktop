import { useCallback, useEffect, useState } from 'react'
import type { RuntimeStatus } from '../../../electron/runtime/runtime-types'

type Screen = 'loading' | 'recovery'

/**
 * Task 1.3 shell screen. Shows a loading state while the Harness runtime
 * boots; switches to a recovery screen (retry / restart / open logs / quit)
 * when the runtime fails or stops. When the runtime is ready, the main
 * process loads the official Web UI into this window, replacing this view.
 */
export default function App(): React.JSX.Element {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [version, setVersion] = useState('')

  useEffect(() => {
    const desktop = window.desktop
    void desktop.getVersion().then(setVersion)
    void desktop.getRuntimeStatus().then(setStatus)
    const unsubscribe = desktop.onRuntimeStatus(setStatus)
    return unsubscribe
  }, [])

  const screen: Screen = !status || status.state === 'starting' || status.state === 'idle' ? 'loading' : 'recovery'

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

  if (screen === 'loading') {
    return (
      <div className="shell">
        <div className="card">
          <h1>DeepSeek Harness Desktop</h1>
          <p className="muted">Starting local Harness runtime…</p>
          <div className="spinner" aria-label="loading" />
          <p className="muted small">{version && `v${version}`}</p>
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
          <button onClick={onQuit}>Quit</button>
        </div>
      </div>
    </div>
  )
}
