/**
 * Resolve the `dsh` executable: PATH first, then the global npm bin dir.
 * Your shell may not have the global npm bin on PATH — this closes that gap.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function onPath(bin: string): boolean {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/** Candidate dirs for a globally installed dsh, in priority order. */
function candidateDirs(): string[] {
  const dirs: string[] = []
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 10_000 }).trim()
    dirs.push(join(root, '.bin'))
  } catch {
    /* npm unavailable */
  }
  // npm/pnpm may have installed globals under ~/node_modules instead
  dirs.push(join(homedir(), 'node_modules', '.bin'))
  // common Linux/brew layout
  dirs.push('/usr/local/bin')
  return dirs
}

export function findDsh(): string | null {
  if (process.env.DSHD_DSH_BIN) return process.env.DSHD_DSH_BIN
  if (onPath('dsh')) return 'dsh'
  for (const binDir of candidateDirs()) {
    const candidate = join(binDir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
    if (existsSync(candidate)) return candidate
  }
  return null
}
