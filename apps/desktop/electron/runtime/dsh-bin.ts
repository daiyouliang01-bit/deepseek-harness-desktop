/**
 * Resolve the dsh runtime to spawn.
 *
 * Packaged .app: prefer the self-contained runtime bundled under
 * Resources/runtime/ (node + dsh-cli/bin.js). This makes the app independent
 * of any dsh/Node on the user's PATH (ADR-002).
 *
 * Dev build / fallback: PATH `dsh`, then common global npm bin layouts.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A resolved runtime: spawn `command` with `prefixArgs` prepended to the dsh
 * argv. For a PATH dsh this is `{ command: 'dsh', prefixArgs: [] }`; for the
 * bundled runtime it is `{ command: <bundled-node>, prefixArgs: [<bin.js>] }`.
 */
export interface RuntimeDescriptor {
  command: string
  /** Extra args prepended before the dsh CLI flags (e.g. the bin.js path). */
  prefixArgs: string[]
  /** Human-readable label for logs. */
  label: string
}

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

/**
 * The bundled runtime path inside a packaged .app:
 * <resources>/runtime/node + <resources>/runtime/dsh-cli/.../bin.js.
 * In dev (no resourcesPath or runtime missing) this returns null.
 */
function bundledDescriptor(): RuntimeDescriptor | null {
  // process.resourcesPath is set by Electron for packaged apps; in dev it is
  // undefined. DSHD_BUNDLED_RUNTIME lets tests/overrides point at a dir.
  const base = process.env.DSHD_BUNDLED_RUNTIME ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (!base) return null
  const nodeBin = join(base, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
  const dshBinJs = join(base, 'runtime', 'dsh-cli', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(nodeBin) || !existsSync(dshBinJs)) return null
  return { command: nodeBin, prefixArgs: [dshBinJs], label: `bundled ${nodeBin}` }
}

function pathDescriptor(): RuntimeDescriptor | null {
  if (process.env.DSHD_DSH_BIN) return { command: process.env.DSHD_DSH_BIN, prefixArgs: [], label: `env ${process.env.DSHD_DSH_BIN}` }
  if (onPath('dsh')) return { command: 'dsh', prefixArgs: [], label: 'dsh (PATH)' }
  for (const binDir of candidateDirs()) {
    const candidate = join(binDir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
    if (existsSync(candidate)) return { command: candidate, prefixArgs: [], label: candidate }
  }
  return null
}

/**
 * Resolve the runtime: bundled first (packaged app), then PATH/global bins.
 * Never returns null in practice — a null means "no dsh anywhere" and the
 * caller falls back to 'dsh' to surface a clear ENOENT at spawn time.
 */
export function findRuntime(): RuntimeDescriptor {
  return bundledDescriptor() ?? pathDescriptor() ?? { command: 'dsh', prefixArgs: [], label: 'dsh (fallback)' }
}

/** Legacy single-string resolver, kept for readDshVersion compat. */
export function findDsh(): string | null {
  const d = pathDescriptor()
  return d ? d.command : null
}
