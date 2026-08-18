/**
 * Task — community-links plugin installer.
 *
 * Mirrors phone-sync-installer: the persisted @dshd/community-links plugin is
 * resolved by dsh from the *web profile's* node_modules
 * ($DSH_HOME/profiles/web/node_modules). To make it available without a
 * manual `pnpm install`, this module creates a symlink from the desktop app's
 * bundled plugin dir into the profile's node_modules (same mechanism
 * `dsh plugin add link:` uses under the hood).
 *
 * Called before the runtime starts; idempotent and never fatal.
 */

import { existsSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

export const COMMUNITY_LINKS_PACKAGE = '@dshd/community-links'

/** Where the plugin source lives in this app (repo dev: plugins/, packaged: resources/). */
export function communityLinksSourceDir(appRoot: string): string {
  return join(appRoot, 'plugins', 'community-links')
}

/** $DSH_HOME/profiles/web/node_modules/@dshd */
export function communityLinksTargetDir(dshHome: string): string {
  return join(dshHome, 'profiles', 'web', 'node_modules', '@dshd')
}

/**
 * Ensure the community-links plugin is linked into the web profile. Returns
 * the linked path when (already) linked, or null when linking failed (the app
 * should continue without the community entry rather than crash).
 */
export function ensureCommunityLinksLinked(dshHome: string, appRoot: string): string | null {
  try {
    const source = communityLinksSourceDir(appRoot)
    if (!existsSync(source)) return null
    const targetDir = communityLinksTargetDir(dshHome)
    const linkPath = join(targetDir, 'community-links')
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
