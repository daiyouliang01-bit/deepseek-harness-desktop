/**
 * Resolve the `dsh` executable: PATH first, then the global npm bin dir.
 * Your shell may not have the global npm bin on PATH — this closes that gap.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function onPath(bin: string): boolean {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/** Global npm bin dir, e.g. <prefix>/node_modules/.bin (npm bin was removed in npm 9). */
function globalNpmBin(): string | null {
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 10_000 }).trim()
    return join(root, '.bin')
  } catch {
    return null
  }
}

export function findDsh(): string | null {
  if (process.env.DSHD_DSH_BIN) return process.env.DSHD_DSH_BIN
  if (onPath('dsh')) return 'dsh'
  const binDir = globalNpmBin()
  if (binDir) {
    const candidate = join(binDir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
    if (existsSync(candidate)) return candidate
  }
  return null
}
