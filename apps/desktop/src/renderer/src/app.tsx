import { useEffect, useState } from 'react'

interface ShellInfo {
  version: string
  platform: string
  runtimeState: string
}

/**
 * Task 1.1 placeholder shell UI. This will become the loading screen /
 * recovery screen once Task 1.3 loads the official Harness Web UI.
 */
export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<ShellInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    async function load(): Promise<void> {
      try {
        const desktop = window.desktop
        const [version, platform, status] = await Promise.all([
          desktop.getVersion(),
          desktop.getPlatform(),
          desktop.getRuntimeStatus()
        ])
        if (!disposed) setInfo({ version, platform, runtimeState: status.state })
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    return () => {
      disposed = true
    }
  }, [])

  return (
    <div className="shell">
      <div className="card">
        <h1>DeepSeek Harness Desktop</h1>
        <p className="muted">Secure shell booted — waiting for runtime (Task 1.2/1.3)</p>
        {error && <p className="error">{error}</p>}
        {info && (
          <dl className="meta">
            <div>
              <dt>app version</dt>
              <dd>{info.version}</dd>
            </div>
            <div>
              <dt>platform</dt>
              <dd>{info.platform}</dd>
            </div>
            <div>
              <dt>runtime</dt>
              <dd>{info.runtimeState}</dd>
            </div>
          </dl>
        )}
        <button onClick={() => void window.desktop.quit()}>Quit</button>
      </div>
    </div>
  )
}
