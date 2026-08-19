/** Local HTTP routes for the installed-inventory tab. */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { applySelectedUpdates } from './apply.js'
import { decorateCompleteCandidates, decoratePlugins, noteZh, readDisabledIds, WEB_UI_FEATURES } from './catalog.js'
import { readUserPlugins } from './inventory.js'
import { readUserSkills } from './skills.js'
import { checkAllUpdates } from './updates.js'

const BODY_LIMIT_BYTES = 4 * 1024
const PROFILE_RE = /^[A-Za-z0-9_-]+$/
// Node versions disagree whether URL.hostname for IPv6 is '::1' or '[::1]'.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} value
 */
export function sendJson(response, status, value) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
}

/**
 * @param {import('node:http').IncomingMessage} request
 */
export function isLoopbackHost(request) {
  const host = request.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    const hostname = new URL(`http://${host}`).hostname
    return LOOPBACK.has(hostname)
  } catch {
    return false
  }
}

/**
 * @param {import('node:http').IncomingMessage} request
 */
export function isSameOrigin(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && url.host === host && LOOPBACK.has(url.hostname)
  } catch {
    return false
  }
}

/**
 * @param {import('node:http').IncomingMessage} request
 */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > BODY_LIMIT_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * @param {string} profile
 * @param {string} [dshHome]
 */
export function profileDirectory(profile, dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  return join(dshHome, 'profiles', profile)
}

/**
 * @param {string} profileDir
 */
export function readProfileDisabled(profileDir) {
  try {
    return readDisabledIds(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'))
  } catch {
    return new Set()
  }
}

/**
 * @param {string} profileDir
 */
export function readFeatureVersions(profileDir) {
  /** @type {Record<string, string>} */
  const versions = {}
  for (const feature of WEB_UI_FEATURES) {
    const manifest = join(profileDir, 'node_modules', ...feature.name.split('/'), 'package.json')
    try {
      if (!existsSync(manifest)) continue
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof parsed.version === 'string') versions[feature.name] = parsed.version
    } catch {
      // missing feature package: skip
    }
  }
  return versions
}

/**
 * @param {Array<Record<string, unknown>>} items
 */
function withNotes(items) {
  return items.map((item) => {
    const update = item.update && typeof item.update === 'object'
      ? /** @type {Record<string, unknown>} */ (item.update)
      : null
    if (!update || update.status !== 'available') return item
    const note = typeof update.note === 'string' && update.note !== '' ? update.note : null
    return {
      ...item,
      update: {
        ...update,
        noteZh: note || noteZh(String(update.current || item.version || ''), String(update.latest || ''), String(item.summaryZh || item.description || '')),
      },
    }
  })
}

/**
 * @param {{ profileDir: string, homedir: string, dshHome: string, cwd?: string | null }} roots
 */
export function collectInventory(roots) {
  const disabled = readProfileDisabled(roots.profileDir)
  const featureVersions = readFeatureVersions(roots.profileDir)
  const rawPlugins = readUserPlugins(roots.profileDir)
  return {
    plugins: decoratePlugins(rawPlugins, { disabled, featureVersions }),
    candidates: decorateCompleteCandidates(rawPlugins, disabled, featureVersions),
    skills: readUserSkills({
      homedir: roots.homedir,
      dshHome: roots.dshHome,
      cwd: roots.cwd ?? null,
    }),
    disabled: [...disabled],
  }
}

/**
 * @param {{
 *   profile: string,
 *   dshHome?: string,
 *   homedir?: string,
 *   fetcher?: typeof fetch,
 *   applyRunner?: Function,
 * }} config
 */
export function createHandlers(config) {
  if (!PROFILE_RE.test(config.profile)) throw new Error(`invalid profile name: ${config.profile}`)
  const home = config.homedir ?? homedir()
  const dshHome = config.dshHome ?? process.env.DSH_HOME ?? join(home, '.dsh')
  const profileDir = profileDirectory(config.profile, dshHome)
  const fetcher = config.fetcher ?? fetch
  const applyRunner = config.applyRunner

  function rootsFromQuery(request) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const cwd = url.searchParams.get('cwd')
    return {
      profileDir,
      homedir: home,
      dshHome,
      cwd: cwd && cwd.startsWith('/') ? cwd : null,
    }
  }

  return {
    async list(request, response) {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      if (!isLoopbackHost(request)) {
        sendJson(response, 403, { error: 'loopback-only' })
        return
      }
      sendJson(response, 200, collectInventory(rootsFromQuery(request)))
    },

    async check(request, response) {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' })
        response.end()
        return
      }
      if (!isLoopbackHost(request) || !isSameOrigin(request)) {
        sendJson(response, 403, { error: 'untrusted origin' })
        return
      }
      try {
        const body = await readJsonBody(request)
        const cwd = typeof body?.cwd === 'string' && body.cwd.startsWith('/') ? body.cwd : null
        const inventory = collectInventory({ profileDir, homedir: home, dshHome, cwd })
        const checked = await checkAllUpdates(inventory, fetcher)
        sendJson(response, 200, {
          ...checked,
          plugins: withNotes(checked.plugins),
          candidates: withNotes(await attachCandidateUpdates(inventory.candidates, checked, fetcher)),
          skills: withNotes(checked.skills),
          disabled: inventory.disabled,
        })
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },

    async apply(request, response) {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' })
        response.end()
        return
      }
      if (!isLoopbackHost(request) || !isSameOrigin(request)) {
        sendJson(response, 403, { error: 'untrusted origin' })
        return
      }
      try {
        const body = await readJsonBody(request)
        const cwd = typeof body?.cwd === 'string' && body.cwd.startsWith('/') ? body.cwd : null
        const mode = body?.mode === 'complete' ? 'complete' : 'local'
        const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string') : []
        const inventory = collectInventory({ profileDir, homedir: home, dshHome, cwd })
        const checked = await checkAllUpdates({
          plugins: inventory.candidates,
          skills: inventory.skills,
        }, fetcher)
        const result = await applySelectedUpdates({
          items: withNotes(checked.plugins),
          mode,
          ids,
          disabled: new Set(inventory.disabled),
          profileDir,
          run: applyRunner,
        })
        const next = collectInventory({ profileDir, homedir: home, dshHome, cwd })
        sendJson(response, result.ok ? 200 : 500, { ...result, ...next })
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}

/**
 * Complete-update picker needs versions for removed features too.
 * @param {Array<Record<string, unknown>>} candidates
 * @param {{ plugins: Array<Record<string, unknown>> }} checked
 * @param {typeof fetch} fetcher
 */
async function attachCandidateUpdates(candidates, checked, fetcher) {
  const byName = new Map(checked.plugins.map((item) => [item.name, item]))
  const missing = candidates.filter((item) => !byName.has(item.name))
  if (missing.length === 0) {
    return candidates.map((item) => ({ ...item, update: byName.get(item.name)?.update || item.update }))
  }
  const extra = await checkAllUpdates({ plugins: missing, skills: [] }, fetcher)
  for (const item of extra.plugins) byName.set(item.name, item)
  return candidates.map((item) => ({ ...item, update: byName.get(item.name)?.update || item.update }))
}

/**
 * @param {{ register: Function }} webServer
 * @param {Parameters<typeof createHandlers>[0]} config
 */
export function mountRoutes(webServer, config) {
  const handlers = createHandlers(config)
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: '/dsh-installed/list',
      handler: handlers.list,
    }),
    webServer.register({
      kind: 'exact',
      path: '/dsh-installed/check-updates',
      handler: handlers.check,
    }),
    webServer.register({
      kind: 'exact',
      path: '/dsh-installed/apply-updates',
      handler: handlers.apply,
    }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
