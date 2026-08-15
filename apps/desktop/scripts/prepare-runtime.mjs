/**
 * Task 1.4 — prepare the pinned dsh runtime for packaging.
 *
 * Dev builds: verify the `dsh` binary is available on PATH (dev machines
 * install Node + dsh themselves).
 *
 * Release builds (later): resolve the pinned runtime version from the runtime
 * manifest (Task 2.3), download/inline it, and emit the extraResources entry
 * for electron-builder so end users need no global Node.js (ADR-002).
 *
 * Usage: node scripts/prepare-runtime.mjs [--release]
 */
import { execFileSync } from 'node:child_process'

const isRelease = process.argv.includes('--release')

function dshVersion() {
  return execFileSync('dsh', ['--version'], { encoding: 'utf8' }).trim()
}

try {
  const version = dshVersion()
  console.log(`[prepare-runtime] dsh available: ${version}`)
  if (isRelease) {
    // TODO(Task 2.3): read runtime manifest, download pinned runtime into
    // build/runtime, and emit extraResources. Blocked on runtime manifest.
    console.warn('[prepare-runtime] release runtime bundling not implemented yet (Task 2.3)')
    process.exit(1)
  }
  console.log('[prepare-runtime] dev build OK — relying on globally installed dsh')
} catch (err) {
  console.error(
    '[prepare-runtime] dsh not found on PATH. Dev builds need a working `dsh` CLI (see docs/upstream-contract.md).'
  )
  console.error(String(err))
  process.exit(1)
}
