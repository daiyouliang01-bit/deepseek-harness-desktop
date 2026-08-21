// src/plugin/paths.ts
import { resolve, extname, sep } from 'node:path'

const allowedRoots = new Set<string>()

export function addAllowedRoot(p: string): void {
  allowedRoots.add(resolve(p))
}

export function assertAllowedPath(p: string): string {
  if (!p.startsWith('/')) throw new Error('FP_PATH_DENIED')
  const resolved = resolve(p)
  for (const root of allowedRoots) {
    if (resolved === root || resolved.startsWith(root + sep)) return resolved
  }
  throw new Error('FP_PATH_DENIED')
}

const TEXT_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'css', 'html', 'htm',
  'yml', 'yaml', 'toml', 'sh', 'py', 'go', 'rs', 'c', 'h', 'cpp', 'java',
  'xml', 'sql', 'log', 'ini', 'cfg', 'env', 'gitignore', 'vue', 'svelte',
])

const IMAGE_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
}

export function contentTypeForPath(p: string): string {
  const ext = extname(p).slice(1).toLowerCase()
  if (ext === 'md') return 'text/markdown'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'html' || ext === 'htm') return 'text/html'
  if (ext in IMAGE_EXT) return IMAGE_EXT[ext]!
  if (ext === 'docx' || ext === 'doc' || ext === 'rtf') return 'application/octet-stream'
  if (TEXT_EXT.has(ext)) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}
