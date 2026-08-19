/** Explicit update checks. Failures never become "available". */
import { classifySpec, parseGithubSpec } from './inventory.js'

export const FETCH_TIMEOUT_MS = 8_000
export const UPDATE_CONCURRENCY = 4

/** Per-check cache of GitHub release lookups (shared repo = one fetch). */
const githubCache = new Map()

/** Clean a release body into a compact one-line Chinese-ish summary. */
export function cleanNote(body) {
  if (typeof body !== 'string' || body === '') return ''
  const withoutFences = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (withoutFences === '') return ''
  return withoutFences.length > 120 ? withoutFences.slice(0, 117).trimEnd() + '…' : withoutFences
}

/**
 * @param {string} value
 * @returns {{ core: number[], prerelease: string[] } | null}
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  }
}

/**
 * Positive means left is newer. Invalid input returns null (never throw).
 * @param {string} leftValue
 * @param {string} rightValue
 * @returns {number | null}
 */
export function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  if (left === null || right === null) return null
  for (let index = 0; index < left.core.length; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

function localResult(current) {
  return { status: 'local', current: current ?? null, latest: null, url: null, error: null }
}

function errorResult(current, error) {
  return { status: 'error', current: current ?? null, latest: null, url: null, error }
}

function comparedResult(current, latest, url, note = '') {
  const delta = compareVersions(latest, current)
  if (delta === null) return errorResult(current, 'uncomparable versions')
  return {
    status: delta > 0 ? 'available' : 'up-to-date',
    current,
    latest,
    url,
    note,
    error: null,
  }
}

/**
 * @param {string} url
 * @param {typeof fetch} fetcher
 */
async function fetchJson(url, fetcher) {
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:') throw new Error('update URL must use HTTPS')
  const response = await fetcher(endpoint, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/**
 * @param {string} name
 * @param {typeof fetch} fetcher
 */
async function npmLatest(name, fetcher) {
  const encoded = name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name)
  const body = await fetchJson(`https://registry.npmjs.org/${encoded}/latest`, fetcher)
  if (body === null || typeof body !== 'object' || typeof body.version !== 'string') {
    throw new Error('npm latest missing version')
  }
  return { version: body.version, url: `https://www.npmjs.com/package/${name}` }
}

/**
 * @param {{ owner: string, repo: string }} repo
 * @param {typeof fetch} fetcher
 */
async function githubLatest(repo, fetcher) {
  const key = `${repo.owner}/${repo.repo}`
  if (githubCache.has(key)) return githubCache.get(key)
  const body = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, fetcher)
  const tag = typeof body?.tag_name === 'string' ? body.tag_name : null
  if (tag === null) throw new Error('github release missing tag')
  const result = {
    version: tag.replace(/^v/, ''),
    url: typeof body.html_url === 'string' ? body.html_url : `https://github.com/${repo.owner}/${repo.repo}/releases`,
    note: cleanNote(typeof body.body === 'string' ? body.body : ''),
  }
  githubCache.set(key, result)
  return result
}

/**
 * @param {Record<string, unknown>} plugin
 * @param {typeof fetch} fetcher
 */
export async function checkPluginUpdate(plugin, fetcher) {
  const current = typeof plugin.version === 'string' ? plugin.version : null
  const origin = plugin.origin || classifySpec(String(plugin.spec ?? ''))
  if (origin === 'local') return localResult(current)
  if (current === null) return errorResult(current, 'installed version unknown')
  const repo = plugin.github && typeof plugin.github === 'object'
    ? /** @type {{ owner: string, repo: string }} */ (plugin.github)
    : parseGithubSpec(String(plugin.spec ?? ''))
  try {
    // Prefer the GitHub release (it carries a Chinese change note); fall back
    // to the npm registry for version-only comparison when the repo has no
    // release or the api call fails.
    if (repo !== null) {
      try {
        const latest = await githubLatest(repo, fetcher)
        return comparedResult(current, latest.version, latest.url, latest.note)
      } catch (githubError) {
        const latest = await npmLatest(String(plugin.name), fetcher)
        return comparedResult(current, latest.version, latest.url)
      }
    }
    if (origin === 'npm') {
      const latest = await npmLatest(String(plugin.name), fetcher)
      return comparedResult(current, latest.version, latest.url)
    }
    return errorResult(current, 'unknown origin')
  } catch (error) {
    return errorResult(current, error instanceof Error ? error.message : String(error))
  }
}

/**
 * @param {Record<string, unknown>} skill
 * @param {typeof fetch} fetcher
 */
export async function checkSkillUpdate(skill, fetcher) {
  const current = typeof skill.version === 'string' ? skill.version : null
  const remote = typeof skill.gitRemote === 'string' ? skill.gitRemote : null
  if (remote === null) return localResult(current)
  const repo = parseGithubSpec(remote)
  if (repo === null || current === null) {
    return current === null
      ? errorResult(current, 'skill has remote but no version')
      : errorResult(current, 'skill remote is not a github URL')
  }
  try {
    const latest = await githubLatest(repo, fetcher)
    return comparedResult(current, latest.version, latest.url)
  } catch (error) {
    return errorResult(current, error instanceof Error ? error.message : String(error))
  }
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Promise<unknown>} worker
 * @param {number} concurrency
 */
async function mapPool(items, worker, concurrency) {
  const results = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index])
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) || 0 }, () => run())
  await Promise.all(workers)
  return results
}

/**
 * @param {{ plugins: Array<Record<string, unknown>>, skills: Array<Record<string, unknown>> }} inventory
 * @param {typeof fetch} fetcher
 */
export async function checkAllUpdates(inventory, fetcher = fetch) {
  const plugins = await mapPool(
    inventory.plugins,
    async (plugin) => ({ ...plugin, update: await checkPluginUpdate(plugin, fetcher) }),
    UPDATE_CONCURRENCY,
  )
  const skills = await mapPool(
    inventory.skills,
    async (skill) => ({ ...skill, update: await checkSkillUpdate(skill, fetcher) }),
    UPDATE_CONCURRENCY,
  )
  return { plugins, skills }
}
