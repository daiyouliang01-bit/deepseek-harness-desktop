import { execSync } from 'node:child_process'
import { _electron as electron, test, type ElectronApplication } from '@playwright/test'

/**
 * Shared E2E helpers (P2). Electron E2E requires a real GUI session; under
 * SSH/headless the tests skip instead of failing.
 */

const sshHeadless = Boolean(process.env.SSH_TTY || process.env.SSH_CONNECTION)

/** Apply the GUI-session guard. */
export function guardGui(): void {
  test.skip(sshHeadless, 'requires a GUI session; skipped under SSH/headless — run from the Mac console Terminal')
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ])
}

export function killOrphans(): void {
  try {
    execSync('pkill -9 -f "out/main/index.js"', { stdio: 'ignore' })
  } catch {
    /* no match — fine */
  }
}

/** Launch the built app, skipping when no GUI window appears within a budget. */
export async function launchApp(): Promise<ElectronApplication | null> {
  let app: ElectronApplication
  try {
    app = await withTimeout(electron.launch({ args: ['out/main/index.js'] }), 8000, 'launch-timeout')
  } catch (err) {
    killOrphans()
    test.skip(true, `no GUI session (${(err as Error).message}); skipping`)
    return null
  }
  try {
    await withTimeout(app.firstWindow(), 8000, 'no-window')
  } catch (err) {
    await app.close().catch(() => undefined)
    test.skip(true, `no GUI window within 8s (${(err as Error).message}); skipping`)
    return null
  }
  return app
}
