/**
 * Task 5.4 — support bundle: logs + versions + config (never secrets).
 *
 * Produces a zip (or directory) with everything needed to debug an issue,
 * explicitly excluding API keys and other secrets.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface BundleInput {
  /** directory containing logs to include */
  logsDir: string
  /** app version string */
  appVersion: string
  /** runtime version string */
  runtimeVersion: string
  /** platform string */
  platform: string
  /** any extra files (paths) to include */
  extraFiles?: string[]
  /** paths that must NEVER be included (e.g. secrets store) */
  excludedPaths?: string[]
}

const DEFAULT_EXCLUDED = ['secrets.json']

export function buildSupportBundle(input: BundleInput, outDir: string): { dir: string; files: string[] } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(outDir, `support-bundle-${stamp}`)
  mkdirSync(dir, { recursive: true })

  // 1. info file
  const info = {
    appVersion: input.appVersion,
    runtimeVersion: input.runtimeVersion,
    platform: input.platform,
    generatedAt: new Date().toISOString()
  }
  writeFileSync(join(dir, 'info.json'), JSON.stringify(info, null, 2))

  // 2. logs
  const files: string[] = []
  if (existsSync(input.logsDir)) {
    for (const f of readdirSync(input.logsDir)) {
      if (input.excludedPaths?.includes(f)) continue
      const src = join(input.logsDir, f)
      if (statSync(src).isFile()) {
        const dest = join(dir, 'logs', f)
        mkdirSync(join(dir, 'logs'), { recursive: true })
        copyFileSync(src, dest)
        files.push(`logs/${f}`)
      }
    }
  }

  // 3. extra files (skipping excluded)
  for (const extra of input.extraFiles ?? []) {
    if (input.excludedPaths?.some((e) => basename(extra) === e)) continue
    if (!existsSync(extra)) continue
    const dest = join(dir, 'extra', basename(extra))
    mkdirSync(join(dir, 'extra'), { recursive: true })
    copyFileSync(extra, dest)
    files.push(`extra/${basename(extra)}`)
  }

  return { dir, files: ['info.json', ...files] }
}

/** Scan a directory tree for files matching secret patterns (safety check). */
export function scanForSecrets(dir: string, patterns: RegExp[] = [/sk-[A-Za-z0-9]{16,}/, /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9]{16,}/i]): string[] {
  const hits: string[] = []
  const walk = (d: string): void => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      const st = statSync(p)
      if (st.isDirectory()) {
        walk(p)
        continue
      }
      if (st.size > 1_000_000) continue
      try {
        const text = readFileSync(p, 'utf8')
        for (const re of patterns) {
          if (re.test(text)) {
            hits.push(p)
            break
          }
        }
      } catch {
        /* binary/unreadable */
      }
    }
  }
  walk(dir)
  return hits
}
