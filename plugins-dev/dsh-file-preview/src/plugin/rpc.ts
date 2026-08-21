// src/plugin/rpc.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { assertAllowedPath, addAllowedRoot } from './paths.ts'
import { docxToHtml } from './convert.ts'

const execFileAsync = promisify(execFile)
const DEFAULT_MAX = 2 * 1024 * 1024

export interface DirEntry { name: string; path: string; isDir: boolean; size: number; mtime: number }
export interface StatResult { exists: boolean; isDir: boolean; size: number; mtime: number; ext: string }

export async function listDir(p: string): Promise<DirEntry[]> {
  const dir = assertAllowedPath(p)
  const names = await readdir(dir)
  const entries = await Promise.all(names.map(async (name) => {
    const full = join(dir, name)
    const st = await stat(full)
    return { name, path: full, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs }
  }))
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return entries
}

export async function readText(p: string, maxBytes = DEFAULT_MAX): Promise<{ text: string; truncated: boolean; mtime: number }> {
  const file = assertAllowedPath(p)
  const st = await stat(file)
  const buf = await readFile(file)
  const truncated = buf.length > maxBytes
  return { text: buf.subarray(0, maxBytes).toString('utf-8'), truncated, mtime: st.mtimeMs }
}

export async function statPath(p: string): Promise<StatResult> {
  try {
    const file = assertAllowedPath(p)
    const st = await stat(file)
    return { exists: true, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, ext: extname(file) }
  } catch {
    return { exists: false, isDir: false, size: 0, mtime: 0, ext: extname(p) }
  }
}

export async function openInApp(p: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const file = assertAllowedPath(p)
    await execFileAsync('open', [file])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function pickFile(): Promise<{ path: string } | null> {
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', 'POSIX path of (choose file)'])
    const path = stdout.trim()
    if (!path) return null
    addAllowedRoot(path)
    return { path }
  } catch {
    return null // user cancelled
  }
}

export async function dispatchFpCall(
  cwd: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const path = String(body.path ?? '')
  const fn = String(body.fn ?? '')
  switch (fn) {
    case 'listDir': return listDir(path)
    case 'readText': return readText(path, typeof body.maxBytes === 'number' ? body.maxBytes : undefined)
    case 'stat': return statPath(path)
    case 'docxToHtml': return docxToHtml(path)
    case 'openInApp': return openInApp(path)
    case 'pickFile': return pickFile()
    case 'setRoot': {
      const root = String(body.root ?? '').trim()
      if (!root.startsWith('/')) throw new Error('FP_ROOT_DENIED')
      const rootStat = await stat(root)
      if (!rootStat.isDirectory()) throw new Error('FP_ROOT_NOT_DIRECTORY')
      addAllowedRoot(root)
      return { root }
    }
    case 'getRoot': return { root: cwd }
    default: return { error: `unknown fp method ${fn}` }
  }
}

/** Legacy helper kept for tests: registers via a handle (not used in prod). */
export function registerRpcHandlers(
  handle: (method: string, h: (args: unknown) => Promise<unknown>) => void,
  cwd: string,
): void {
  addAllowedRoot(cwd)
  handle('fp.call', (args) => dispatchFpCall(cwd, (args ?? {}) as Record<string, unknown>))
}

const MAX_BODY = 64 * 1024

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let buf = ''
    let tooLarge = false
    req.on('data', (chunk: Buffer | string) => {
      if (tooLarge) return
      buf += chunk
      if (buf.length > MAX_BODY) tooLarge = true
    })
    req.on('end', () => {
      if (tooLarge) { resolve({ __tooLarge: true } as unknown as Record<string, unknown>); return }
      try { resolve((buf ? JSON.parse(buf) : {}) as Record<string, unknown>) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

export function createRpcHandler(cwd: string): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  addAllowedRoot(cwd)
  return async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' }); res.end('method not allowed'); return }
    const body = await readJsonBody(req)
    if ((body as Record<string, unknown>).__tooLarge) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'body too large' }))
      return
    }
    try {
      const out = await dispatchFpCall(cwd, body)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out ?? null))
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
    }
  }
}
