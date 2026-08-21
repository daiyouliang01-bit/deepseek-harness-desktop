/**
 * Desktop ↔ 3080 isolation (hard rule — do not weaken).
 *
 * - The standalone `dsh web` on :3080 owns `~/.dsh`. The desktop app never
 *   reads or writes that directory except to *copy out* of it once when
 *   breaking a leaked symlink.
 * - Desktop default is `~/.dsh-desktop`. A configured / env path that equals
 *   `~/.dsh` is rejected and the default is used instead.
 * - No desktop change is synced back to :3080 unless the user explicitly asks.
 * - Official web UI source (`@deepseek-ai/dsh-client-ui-*`) is never patched
 *   by this app.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

export function sharedWebHome(home = homedir()): string {
  return join(home, '.dsh')
}

export function defaultDesktopHome(home = homedir()): string {
  return join(home, '.dsh-desktop')
}

export function isSharedWebHome(path: string, home = homedir()): boolean {
  try {
    return resolve(path) === resolve(sharedWebHome(home))
  } catch {
    return false
  }
}

export function resolveDesktopDshHome(opts: {
  configured?: string | null
  envHome?: string | null
  home?: string
}): string {
  const home = opts.home ?? homedir()
  const fallback = defaultDesktopHome(home)
  for (const raw of [opts.configured, opts.envHome]) {
    if (typeof raw !== 'string') continue
    const next = raw.trim()
    if (next === '') continue
    if (isSharedWebHome(next, home)) continue
    return next
  }
  return fallback
}

function resolveLinkTarget(linkPath: string): string {
  return resolve(dirname(linkPath), readlinkSync(linkPath))
}

export function pointsIntoSharedHome(linkPath: string, sharedRoot: string): boolean {
  if (!existsSync(linkPath) && !isBrokenSymlink(linkPath)) return false
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return false
    const target = resolveLinkTarget(linkPath)
    const shared = resolve(sharedRoot)
    return target === shared || target.startsWith(shared + sep)
  } catch {
    return false
  }
}

function isBrokenSymlink(linkPath: string): boolean {
  try {
    return lstatSync(linkPath).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Isolation guard: the desktop profile's `file:` dependencies must never
 * point into the shared web home (`~/.dsh`). A leaked `file:` dep means the
 * desktop shell reads the :3080 data dir when (re)installing profile deps and
 * shares plugin fate with the standalone web instance (the dsh-file-preview
 * `harness` bug took both down in one go). Returns the offending entries as
 * `name -> spec` strings (empty when clean / unreadable).
 */
export function findProfileFileDepsIntoSharedHome(
  profileDir: string,
  sharedRoot: string
): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
    }
    const deps = pkg?.dependencies ?? {}
    const shared = resolve(sharedRoot)
    const out: string[] = []
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string') continue
      const m = /^file:(.+)$/.exec(spec)
      if (!m) continue
      const target = resolve(m[1])
      if (target === shared || target.startsWith(shared + sep)) out.push(`${name} -> ${spec}`)
    }
    return out
  } catch {
    return []
  }
}

/**
 * Copy-then-replace every symlink under `dshHome` that points into `sharedRoot`.
 * Walks nested real directories so leaks like `profiles/web -> ~/.dsh/profiles/web`
 * are caught (top-level-only scans miss them).
 */
export function materializeLeakedLinks(dshHome: string, sharedRoot: string): string[] {
  const done: string[] = []
  walk(dshHome)

  function walk(dir: string): void {
    if (!existsSync(dir)) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const p = join(dir, name)
      if (pointsIntoSharedHome(p, sharedRoot)) {
        materializeOne(p)
        done.push(p.slice(dshHome.length + 1) || name)
        continue
      }
      try {
        const st = lstatSync(p)
        if (st.isDirectory() && !st.isSymbolicLink()) walk(p)
      } catch {
        /* ignore unreadable entries */
      }
    }
  }

  return done
}

/** Desktop-only: default the official UI language to Chinese. Never writes ~/.dsh. */
export function ensureDesktopLocaleZh(dshHome: string): void {
  const file = join(dshHome, 'settings.yaml')
  try {
    const raw = existsSync(file) ? readFileSync(file, 'utf8') : '---\n'
    if (/(?:^|\n)locale:\s*\n(?:[ \t].*\n)*[ \t]+preference:\s*zh\b/.test(raw)) return
    if (/(?:^|\n)locale:\s*$/m.test(raw) || /(?:^|\n)locale:\s*\n/.test(raw)) return
    const trimmed = raw.replace(/\s*$/, '')
    writeFileSync(file, `${trimmed}\nlocale:\n  preference: zh\n`)
  } catch {
    /* never block boot */
  }
}

function materializeOne(linkPath: string): void {
  const target = resolveLinkTarget(linkPath)
  const tmp = `${linkPath}.materializing`
  rmSync(tmp, { recursive: true, force: true })
  if (existsSync(target)) {
    cpSync(target, tmp, { recursive: true, dereference: true, force: true })
  } else if (linkPath.endsWith('.json')) {
    writeFileSync(tmp, '{}\n')
  } else {
    mkdirSync(tmp, { recursive: true })
  }
  unlinkSync(linkPath)
  renameSync(tmp, linkPath)
}
