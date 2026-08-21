import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
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
  // Scope to THIS checkout's built main — a bare `pkill -f out/main/index.js`
  // would also take down every other checkout's dev Electron processes.
  const repoMain = resolve(__dirname, '../../../out/main/index.js')
  try {
    execSync(`pkill -9 -f ${JSON.stringify(repoMain)}`, { stdio: 'ignore' })
  } catch {
    /* no match — fine */
  }
}

/** Grab a free loopback port for this e2e instance's dsh. */
async function pickFreePort(): Promise<{ isFreePort: number }> {
  const net = require('node:net') as typeof import('node:net')
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port > 0 ? resolve({ isFreePort: port }) : reject(new Error('no free port'))))
    })
    srv.on('error', reject)
  })
}

/**
 * Launch the built app in FULL ISOLATION from any running desktop instance:
 * - a throwaway userData dir → its own single-instance lock and session DB
 *   (a second instance sharing the real userData would just hand off to the
 *   running app and exit — every test would race the user's live session);
 * - DSH_DESKTOP_PORT on a random free port → it spawns its OWN dsh instead of
 *   ADOPTING the production runtime on :35880 (adopted runtimes are not ours
 *   to stop/restart — quit/restart tests would touch the user's session).
 * Skips when no GUI window appears within a budget.
 */
export async function launchApp(): Promise<ElectronApplication | null> {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join, resolve } = require('node:path') as typeof import('node:path')
  const userDataDir = mkdtempSync(join(tmpdir(), 'dshd-e2e-'))
  // Prefer THIS repo's bundled runtime over whatever global dsh happens to be
  // on PATH: a version mismatch (global rc.8 vs bundle rc.2) crashes the child
  // on credential-format migration and every request fails.
  const repoBuild = resolve(__dirname, '../../../build/runtime')
  const shimDir = join(userDataDir, 'bin')
  if (existsSync(join(repoBuild, 'node')) && existsSync(join(repoBuild, 'dsh-cli/node_modules/@deepseek-ai/dsh/lib/bin.js'))) {
    mkdirSync(shimDir, { recursive: true })
    const shim = join(shimDir, 'dsh')
    writeFileSync(
      shim,
      '#!/bin/sh\nexec ' +
        JSON.stringify(join(repoBuild, 'node')) +
        ' ' +
        JSON.stringify(join(repoBuild, 'dsh-cli/node_modules/@deepseek-ai/dsh/lib/bin.js')) +
        ' "$@"\n'
    )
    chmodSync(shim, 0o755)
  }
  // Fresh DSH_HOME per instance: two dsh processes writing one session DB is
  // the original corruption incident; never share it with the live app.
  const isolatedHome = join(userDataDir, 'dsh-home')
  mkdirSync(isolatedHome, { recursive: true })
  const { isFreePort } = await pickFreePort()
  let app: ElectronApplication
  try {
    app = await withTimeout(
      electron.launch({
        args: ['--user-data-dir=' + userDataDir, 'out/main/index.js'],
        env: {
          ...process.env,
          DSH_DESKTOP_PORT: String(isFreePort),
          DSHD_DISABLE_UPDATES: '1',
          ...(existsSync(shimDir) ? { PATH: shimDir + ':' + (process.env.PATH ?? '') } : {}),
          DSH_HOME: isolatedHome
        }
      }),
      8000,
      'launch-timeout'
    )
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
