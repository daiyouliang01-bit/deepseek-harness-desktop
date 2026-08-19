/** Read user-installed plugins from one DSH profile. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const OFFICIAL_PREFIX = '@deepseek-ai/'

/**
 * @param {string} path
 * @returns {unknown}
 */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Classify an install spec. Local paths never get a network check.
 * @param {string} spec
 * @returns {'npm' | 'github' | 'local' | 'unknown'}
 */
export function classifySpec(spec) {
  const value = String(spec ?? '').trim()
  if (value === '') return 'unknown'
  if (
    value.startsWith('file:')
    || value.startsWith('link:')
    || value.startsWith('workspace:')
    || value.startsWith('catalog:')
    || value.startsWith('.')
    || value.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return 'local'
  }
  if (
    value.startsWith('github:')
    || /^(?:git\+)?https:\/\/github\.com\//.test(value)
    || value.startsWith('git@github.com:')
    || value.startsWith('git+ssh://git@github.com')
    || value.startsWith('ssh://git@github.com')
  ) {
    return 'github'
  }
  // Only version ranges, tags, and npm: protocol are npm. Leftovers stay unknown
  // so a successful registry hit cannot false-report "available".
  if (
    value.startsWith('npm:')
    || /^(?:latest|next|\*|x)$/i.test(value)
    || /^[~^>=<]/.test(value)
    || /^\d/.test(value)
    || /^v\d/.test(value)
  ) {
    return 'npm'
  }
  return 'unknown'
}

/**
 * @param {string} spec
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGithubSpec(spec) {
  const value = String(spec ?? '').trim()
  const match = /(?:github:|(?:git\+)?https:\/\/github\.com\/|git\+ssh:\/\/git@github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/#]+\/[^/#]+)/.exec(value)
  if (match === null) return null
  const [owner, repo] = match[1].replace(/\.git$/, '').split('/')
  if (!owner || !repo) return null
  return { owner, repo }
}

/**
 * @param {string} profileDir
 * @param {string} name
 * @param {string} spec
 */
function pluginFromInstall(profileDir, name, spec) {
  const manifestPath = join(profileDir, 'node_modules', ...name.split('/'), 'package.json')
  const manifest = readJson(manifestPath)
  const pkg = manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest)
    ? /** @type {Record<string, unknown>} */ (manifest)
    : {}
  const version = typeof pkg.version === 'string' ? pkg.version : null
  const description = typeof pkg.description === 'string' ? pkg.description : ''
  const homepage = typeof pkg.homepage === 'string' ? pkg.homepage : null
  const origin = classifySpec(spec)
  const repository = typeof pkg.repository === 'string'
    ? pkg.repository
    : (pkg.repository !== null && typeof pkg.repository === 'object'
        ? /** @type {Record<string, unknown>} */ (pkg.repository).url
        : '')
  return {
    kind: /** @type {const} */ ('plugin'),
    id: name,
    name,
    version,
    spec: String(spec ?? ''),
    description,
    origin,
    homepage,
    repository: typeof repository === 'string' ? repository : '',
    github: parseGithubSpec(spec) ?? parseGithubSpec(typeof repository === 'string' ? repository : ''),
  }
}

/**
 * User-installed plugins: profile dependencies minus official DSH packages,
 * plus desktop-local `@dshd/*` rows that only exist as patch inserts.
 * @param {string} profileDir
 */
export function readUserPlugins(profileDir) {
  const byName = new Map()
  const manifest = readJson(join(profileDir, 'package.json'))
  const deps = manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest)
    ? /** @type {Record<string, unknown>} */ (manifest).dependencies
    : null
  if (deps !== null && typeof deps === 'object' && !Array.isArray(deps)) {
    for (const [name, spec] of Object.entries(deps)) {
      if (name.startsWith(OFFICIAL_PREFIX)) continue
      byName.set(name, pluginFromInstall(profileDir, name, String(spec ?? '')))
    }
  }

  const dshd = join(profileDir, 'node_modules', '@dshd')
  try {
    if (existsSync(dshd) && statSync(dshd).isDirectory()) {
      for (const entry of readdirSync(dshd, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const name = `@dshd/${entry.name}`
        if (byName.has(name)) continue
        byName.set(name, pluginFromInstall(profileDir, name, `file:node_modules/${name}`))
      }
    }
  } catch {
    // missing or unreadable @dshd dir: skip, do not invent plugins
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}
