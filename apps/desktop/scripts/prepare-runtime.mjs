/**
 * Task 1.4 — prepare the pinned dsh runtime for packaging.
 *
 * Dev builds: verify the `dsh` binary is available (PATH or global npm bin).
 *
 * Release builds (later): resolve the pinned runtime version from the runtime
 * manifest (Task 2.3), download/inline it, and emit the extraResources entry
 * for electron-builder so end users need no global Node.js (ADR-002).
 *
 * Usage: node scripts/prepare-runtime.mjs [--release]
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const isRelease = process.argv.includes('--release')

function onPath(bin) {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/** Find `dsh`: PATH first, then the global npm bin directory
 *  (`npm bin -g` was removed in npm 9 — use `npm root -g` + .bin). */
function findDsh() {
  if (process.env.DSHD_DSH_BIN) return process.env.DSHD_DSH_BIN
  if (onPath('dsh')) return 'dsh'
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 10_000 }).trim()
    const candidate = join(root, '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
    if (existsSync(candidate)) return candidate
  } catch {
    /* npm unavailable */
  }
  return null
}

function dshVersion(bin) {
  return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim()
}

try {
  const bin = findDsh()
  if (!bin) {
    console.error(
      '[prepare-runtime] dsh not found on PATH or in the global npm bin. ' +
        'Dev builds need a working `dsh` CLI (npm i -g @deepseek-ai/dsh).'
    )
    process.exit(1)
  }
  const version = dshVersion(bin)
  console.log(`[prepare-runtime] dsh available (${bin}): ${version}`)
  if (isRelease) {
    // TODO(Task 2.3): read runtime manifest, download pinned runtime into
    // build/runtime, and emit extraResources. Blocked on runtime manifest.
    console.warn('[prepare-runtime] release runtime bundling not implemented yet (Task 2.3)')
    process.exit(1)
  }
  console.log('[prepare-runtime] dev build OK — relying on dsh from:', bin)
} catch (err) {
  console.error('[prepare-runtime] failed:', String(err))
  process.exit(1)
}
