/**
 * Task 7.2 — phone-sync plugin installer.
 *
 * The persisted @dshd/phone-sync plugin is resolved by dsh from the *web
 * profile's* node_modules ($DSH_HOME/profiles/web/node_modules). To make it
 * available without a manual `pnpm install`, this module creates a symlink
 * from the desktop app's bundled plugin dir into the profile's node_modules
 * (same mechanism `dsh plugin add link:` uses under the hood).
 *
 * Called before the runtime starts; idempotent and never fatal.
 */

import { existsSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PHONE_SYNC_PACKAGE = '@dshd/phone-sync'

/** Where the plugin source lives in this app (repo dev: plugins/, packaged: resources/). */
export function phoneSyncSourceDir(appRoot: string): string {
  return join(appRoot, 'plugins', 'phone-sync')
}

/** $DSH_HOME/profiles/web/node_modules/@dshd */
export function profileTargetDir(dshHome: string): string {
  return join(dshHome, 'profiles', 'web', 'node_modules', '@dshd')
}

/**
 * Ensure the phone-sync plugin is linked into the web profile. Returns the
 * linked path when (already) linked, or null when linking failed (the app
 * should continue without phone access rather than crash).
 */
export function ensurePhoneSyncLinked(dshHome: string, appRoot: string): string | null {
  try {
    const source = phoneSyncSourceDir(appRoot)
    if (!existsSync(source)) return null
    const targetDir = profileTargetDir(dshHome)
    const linkPath = join(targetDir, 'phone-sync')
    if (existsSync(linkPath)) {
      // Refresh a stale symlink (dev: source moved between checkouts).
      try {
        if (readlinkSync(linkPath) !== source) {
          const { rmSync } = require('node:fs') as typeof import('node:fs')
          rmSync(linkPath, { force: true })
          mkdirSync(targetDir, { recursive: true })
          symlinkSync(source, linkPath, 'dir')
        }
      } catch {
        /* not a symlink — leave it (user may have a real install) */
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

export { dirname }
