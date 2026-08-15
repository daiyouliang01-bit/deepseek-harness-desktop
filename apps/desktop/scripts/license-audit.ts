/**
 * Task 5.4 — SBOM + license audit for the desktop app.
 *
 * Generates a dependency inventory from the pnpm lockfile and flags
 * non-permissive licenses. Pure + testable.
 */

export interface DependencyEntry {
  name: string
  version: string
  license: string
  /** true when the license is permissive (MIT/Apache-2.0/BSD/ISC/0BSD) */
  permissive: boolean
}

const PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|0BSD|MPL-2\.0)$/

/** Parse a pnpm-lock.yaml-ish text into dependency entries (simplified). */
export function parseLockfile(text: string): DependencyEntry[] {
  const entries: DependencyEntry[] = []
  const lineRe = /^\s{2}([@a-z0-9][a-z0-9._/-]*)@(\d+\.\d+\.\d+[^:]*):/
  for (const line of text.split(/\r?\n/)) {
    const m = lineRe.exec(line)
    if (m) {
      entries.push({ name: m[1], version: m[2], license: 'UNKNOWN', permissive: false })
    }
  }
  return dedupe(entries)
}

/** Merge with license info from a package.json scan. */
export function annotateLicenses(entries: DependencyEntry[], packageJsonFiles: Array<{ name: string; license: string }>): DependencyEntry[] {
  const byName = new Map(packageJsonFiles.map((p) => [p.name, p.license]))
  return entries.map((e) => {
    const license = byName.get(e.name) ?? 'UNKNOWN'
    return { ...e, license, permissive: PERMISSIVE.test(license) }
  })
}

/** List entries whose license is missing or non-permissive. */
export function audit(entries: DependencyEntry[]): DependencyEntry[] {
  return entries.filter((e) => !e.permissive)
}

function dedupe(entries: DependencyEntry[]): DependencyEntry[] {
  const seen = new Set<string>()
  const out: DependencyEntry[] = []
  for (const e of entries) {
    const key = `${e.name}@${e.version}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}
