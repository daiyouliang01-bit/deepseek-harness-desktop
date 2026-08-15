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

export function findDsh() {
  if (process.env.DSHD_DSH_BIN) return process.env.DSHD_DSH_BIN
  if (onPath('dsh')) return 'dsh'
  try {
    const binDir = execFileSync('npm', ['bin', '-g'], { encoding: 'utf8', timeout: 10_000 }).trim()
    const candidate = join(binDir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
    if (existsSync(candidate)) return candidate
  } catch {
    /* npm unavailable — fall through */
  }
  return null
}
