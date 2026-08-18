/**
 * phone-settings plugin installer.
 *
 * Mirrors phone-sync-installer / community-links-installer: the persisted
 * @dshd/phone-settings plugin is resolved by dsh from the *web profile's*
 * node_modules ($DSH_HOME/profiles/web/node_modules). To make it available
 * without a manual `pnpm install`, this module creates a symlink from the
 * desktop app's bundled plugin dir into the profile's node_modules.
 *
 * Called before the runtime starts; idempotent and never fatal.
 */

import { existsSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

export const PHONE_SETTINGS_PACKAGE = '@dshd/phone-settings'

/** Where the plugin source lives in this app (repo dev: plugins/, packaged: resources/). */
export function phoneSettingsSourceDir(appRoot: string): string {
  return join(appRoot, 'plugins', 'phone-settings')
}

/** $DSH_HOME/profiles/web/node_modules/@dshd */
export function phoneSettingsTargetDir(dshHome: string): string {
  return join(dshHome, 'profiles', 'web', 'node_modules', '@dshd')
}

/**
 * Ensure the phone-settings plugin is linked into the web profile. Returns
 * the linked path when (already) linked, or null when linking failed (the app
 * should continue without the phone settings page rather than crash).
 */
export function ensurePhoneSettingsLinked(dshHome: string, appRoot: string): string | null {
  try {
    const source = phoneSettingsSourceDir(appRoot)
    if (!existsSync(source)) return null
    const targetDir = phoneSettingsTargetDir(dshHome)
    const linkPath = join(targetDir, 'phone-settings')
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
