/** Apply selected plugin updates inside the owning dsh profile. */
import { spawn } from 'node:child_process'
import { completeUpdateTargets, isFeatureEnabled, localUpdateTargets } from './catalog.js'

export const APPLY_TIMEOUT_MS = 180_000

/**
 * @param {string} name
 */
export function safePackageName(name) {
  return /^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(String(name ?? ''))
}

/**
 * @param {Array<Record<string, unknown>>} items
 * @param {{ mode: 'local' | 'complete', ids?: string[], disabled: Set<string> }} request
 */
export function selectApplyItems(items, request) {
  const pool = request.mode === 'complete' ? completeUpdateTargets(items) : localUpdateTargets(items, request.disabled)
  if (request.mode === 'complete' && Array.isArray(request.ids) && request.ids.length > 0) {
    const wanted = new Set(request.ids)
    return pool.filter((item) => wanted.has(String(item.id || item.name)))
  }
  return pool
}

/**
 * @param {string} profileDir
 * @param {string[]} specs
 * @param {{ spawn?: typeof spawn, timeoutMs?: number }} [opts]
 */
export function runPnpmAdd(profileDir, specs, opts = {}) {
  if (specs.length === 0) return Promise.resolve({ ok: true, stdout: '', stderr: '' })
  const run = opts.spawn ?? spawn
  const timeoutMs = opts.timeoutMs ?? APPLY_TIMEOUT_MS
  return new Promise((resolve) => {
    const child = run('dsh', ['plugin', '--profile', 'web', 'add', ...specs], {
      cwd: profileDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, stdout, stderr: stderr || 'update timed out' })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr: error instanceof Error ? error.message : String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, code })
    })
  })
}

/**
 * @param {Array<Record<string, unknown>>} selected
 */
export function specsOf(selected) {
  const specs = []
  for (const item of selected) {
    const name = String(item.name || '')
    const latest = item.update && typeof item.update === 'object'
      ? /** @type {{ latest?: string }} */ (item.update).latest
      : null
    if (!safePackageName(name) || !latest || !/^[v0-9A-Za-z.+-]+$/.test(latest)) continue
    specs.push(`${name}@${latest}`)
  }
  return specs
}

/**
 * @param {{
 *   items: Array<Record<string, unknown>>,
 *   mode: 'local' | 'complete',
 *   ids?: string[],
 *   disabled: Set<string>,
 *   profileDir: string,
 *   run?: typeof runPnpmAdd,
 * }} input
 */
export async function applySelectedUpdates(input) {
  const selected = selectApplyItems(input.items, input)
  const rejected = selected.filter((item) => input.mode === 'local' && !isFeatureEnabled(input.disabled, String(item.name)))
  const allowed = selected.filter((item) => input.mode === 'complete' || isFeatureEnabled(input.disabled, String(item.name)))
  const specs = specsOf(allowed)
  if (specs.length === 0) {
    return { ok: true, applied: [], skipped: rejected.map((item) => item.name), message: '没有可更新的本机功能' }
  }
  const run = input.run ?? runPnpmAdd
  const result = await run(input.profileDir, specs)
  return {
    ok: result.ok,
    applied: specs,
    skipped: rejected.map((item) => item.name),
    message: result.ok ? `已更新 ${specs.length} 个插件` : (result.stderr || '更新失败'),
    detail: [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 4000),
  }
}
