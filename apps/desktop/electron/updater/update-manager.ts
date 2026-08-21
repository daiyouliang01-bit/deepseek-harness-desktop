/** Task 5.3 — auto-update client (electron-updater, GitHub Releases feed). */

/**
 * Injectable update provider so the module is unit-testable outside Electron.
 * Production uses electron-updater's autoUpdater; tests use a fake.
 */
export interface UpdateProvider {
  isEnabled: () => boolean
  check: () => Promise<{ available: boolean; version?: string }>
  download: () => Promise<void>
  install: () => void
  onProgress: (cb: (percent: number) => void) => void
}

export interface UpdateState {
  status: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'
  version?: string
  percent?: number
  error?: string
}

export class UpdateManager {
  private state: UpdateState = { status: 'idle' }
  private listeners = new Set<(s: UpdateState) => void>()

  constructor(private readonly provider: UpdateProvider) {}

  getState(): UpdateState {
    return this.state
  }

  subscribe(cb: (s: UpdateState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Check for updates (no-op when disabled, e.g. dev builds). */
  async check(): Promise<UpdateState> {
    if (!this.provider.isEnabled()) {
      this.setState({ status: 'unsupported', version: undefined, error: 'updates disabled in this build' })
      return this.state
    }
    this.setState({ status: 'checking' })
    try {
      const res = await this.provider.check()
      if (!res.available) {
        this.setState({ status: 'up-to-date' })
      } else {
        this.setState({ status: 'available', version: res.version })
      }
    } catch (err) {
      this.setState({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
    return this.state
  }

  /** Download the available update, reporting progress. */
  async download(): Promise<UpdateState> {
    if (this.state.status !== 'available') return this.state
    this.setState({ status: 'downloading', version: this.state.version })
    this.provider.onProgress((percent) => {
      this.setState({ status: 'downloading', version: this.state.version, percent })
    })
    try {
      await this.provider.download()
      this.setState({ status: 'downloaded', version: this.state.version, percent: 100 })
    } catch (err) {
      this.setState({
        status: 'error',
        version: this.state.version,
        error: err instanceof Error ? err.message : String(err)
      })
    }
    return this.state
  }

  /** Install on quit (the standard, safe UX). */
  install(): void {
    this.provider.install()
  }

  private setState(next: UpdateState): void {
    this.state = next
    for (const l of this.listeners) l(this.state)
  }
}

/** Production provider backed by electron-updater (lazy require). */
export function createElectronUpdaterProvider(): UpdateProvider {
  return {
    isEnabled: () => {
      try {
        return !process.env.DSHD_DISABLE_UPDATES && !process.env.ELECTRON_RENDERER_URL
      } catch {
        return false
      }
    },
    check: async () => {
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
      const result = await autoUpdater.checkForUpdates()
      // Compare against the REAL installed version (app.getVersion()), not
      // npm_package_version: that env var only exists under `npm run` scripts
      // and is undefined in a packaged .app, which made every packaged build
      // report an update as available forever.
      const currentVersion = (require('electron') as typeof import('electron')).app.getVersion()
      const available = !!result?.updateInfo && result.updateInfo.version !== currentVersion
      return { available, version: result?.updateInfo?.version }
    },
    download: async () => {
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
      await autoUpdater.downloadUpdate()
    },
    install: () => {
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
      autoUpdater.quitAndInstall()
    },
    onProgress: (cb) => {
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
      autoUpdater.on('download-progress', (p) => cb(p.percent))
    }
  }
}
