/** Task 2.3 — runtime manifest: pinned + previous known-good versions. */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface RuntimeManifest {
  /** Currently active pinned runtime version (exact dsh version string). */
  current: string
  /** Previous known-good version retained for rollback. */
  previous?: string
  /** History of retained known-good versions (newest first, capped). */
  history: string[]
  /** Max history entries to retain (default 3). */
  maxHistory: number
  /** App version that wrote this manifest. */
  appVersion: string
  updatedAt: string
}

export const MANIFEST_FILE = 'runtime-manifest.json'

export function loadManifest(dir: string): RuntimeManifest | null {
  try {
    const raw = readFileSync(join(dir, MANIFEST_FILE), 'utf8')
    return JSON.parse(raw) as RuntimeManifest
  } catch {
    return null
  }
}

export function saveManifest(dir: string, manifest: RuntimeManifest): void {
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `${MANIFEST_FILE}.tmp`)
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8')
  renameSync(tmp, join(dir, MANIFEST_FILE))
}

export function createManifest(current: string, appVersion: string): RuntimeManifest {
  return {
    current,
    history: [current],
    maxHistory: 3,
    appVersion,
    updatedAt: new Date().toISOString()
  }
}

/**
 * Record an upgrade: push the old current into history (capped), set the new
 * current, retain the previous pointer for one-step rollback.
 */
export function recordUpgrade(manifest: RuntimeManifest, nextVersion: string): RuntimeManifest {
  if (manifest.current === nextVersion) return manifest
  const history = [manifest.current, ...manifest.history.filter((v) => v !== nextVersion)].slice(
    0,
    manifest.maxHistory
  )
  return {
    ...manifest,
    previous: manifest.current,
    current: nextVersion,
    history,
    updatedAt: new Date().toISOString()
  }
}

/** Rollback to the previous known-good version (returns it, or null). */
export function rollback(manifest: RuntimeManifest): RuntimeManifest | null {
  if (!manifest.previous) return null
  const next: RuntimeManifest = {
    ...manifest,
    current: manifest.previous,
    previous: undefined,
    history: [manifest.previous, ...manifest.history.filter((v) => v !== manifest.previous)].slice(
      0,
      manifest.maxHistory
    ),
    updatedAt: new Date().toISOString()
  }
  return next
}

/** Remove a version's runtime directory (used to free space after rollback). */
export function removeRuntimeDir(runtimesDir: string, version: string): void {
  rmSync(join(runtimesDir, version), { recursive: true, force: true })
}

/** List installed runtime version dirs. */
export function listInstalledRuntimes(runtimesDir: string): string[] {
  const { readdirSync } = require('node:fs') as typeof import('node:fs')
  try {
    return readdirSync(runtimesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

/** Resolve the runtime dir for a version. */
export function runtimeDirFor(runtimesDir: string, version: string): string {
  return join(runtimesDir, version)
}

export { dirname }
