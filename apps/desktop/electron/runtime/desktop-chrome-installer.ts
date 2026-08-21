/**
 * Desktop-only chrome plugin installer.
 *
 * Links @dshd/desktop-chrome into $DSH_HOME/profiles/web/node_modules.
 * The desktop app's DSH_HOME is ~/.dsh-desktop, so :3080 (~/.dsh) never
 * sees this package.
 */
import { existsSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

export const DESKTOP_CHROME_PACKAGE = '@dshd/desktop-chrome'

export function desktopChromeSourceDir(appRoot: string): string {
  return join(appRoot, 'plugins', 'desktop-chrome')
}

export function desktopChromeTargetDir(dshHome: string): string {
  return join(dshHome, 'profiles', 'web', 'node_modules', '@dshd')
}

export function resolveDesktopChromeSource(appRoot: string, resourcesPath?: string): string | null {
  for (const root of [appRoot, resourcesPath]) {
    if (!root) continue
    const dir = join(root, 'plugins', 'desktop-chrome')
    if (existsSync(dir)) return dir
  }
  return null
}

export function ensureDesktopChromeLinked(dshHome: string, appRoot: string, resourcesPath?: string): string | null {
  try {
    const source = resolveDesktopChromeSource(appRoot, resourcesPath)
    if (!source) return null
    const targetDir = desktopChromeTargetDir(dshHome)
    const linkPath = join(targetDir, 'desktop-chrome')
    if (existsSync(linkPath)) {
      try {
        if (readlinkSync(linkPath) !== source) {
          const { rmSync } = require('node:fs') as typeof import('node:fs')
          rmSync(linkPath, { force: true })
          mkdirSync(targetDir, { recursive: true })
          symlinkSync(source, linkPath, 'dir')
        }
      } catch {
        /* not a symlink — leave it */
      }
      return linkPath
    }
    mkdirSync(targetDir, { recursive: true })
    symlinkSync(source, linkPath, 'dir')
    return linkPath
  } catch {
    return null
  }
}
