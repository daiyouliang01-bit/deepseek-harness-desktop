// src/plugin/preview-route.ts
import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { assertAllowedPath, contentTypeForPath } from './paths.ts'

const PREFIX = '/preview/'

/** Stream a local file over HTTP. The URL carries the encoded absolute path
 *  after /preview/. Validates the path against the allowed roots first, so
 *  only workspace/picked files are ever served. HEAD returns headers only. */
export async function previewHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  if (!pathname.startsWith(PREFIX)) {
    res.writeHead(404)
    res.end()
    return
  }
  const encoded = pathname.slice(PREFIX.length)
  let target: string
  try {
    target = assertAllowedPath(encoded)
  } catch {
    res.writeHead(403)
    res.end()
    return
  }
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(target)
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  if (!st.isFile()) {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, {
    'Content-Type': contentTypeForPath(target),
    'Content-Length': st.size,
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(target)
  stream.on('error', () => { res.destroy() })
  stream.pipe(res)
}
