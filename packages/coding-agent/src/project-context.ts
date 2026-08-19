export const PROJECT_SNAPSHOT_MAX_BYTES = 12_000

const SKIP = new Set(['node_modules', '.git', 'dist', 'build'])

export type ProjectIo = {
  readText(path: string): Promise<string | null>
  listDir(path: string): Promise<string[]>
}

export type ProjectSnapshot = {
  root: string
  manifestName?: string
  scripts: string[]
  tree: string[]
  omitted: number
  /** UTF-8 byte size of the rendered snapshot (informational). */
  bytes: number
}

function joinPath(root: string, name: string): string {
  return root.endsWith('/') ? `${root}${name}` : `${root}/${name}`
}

async function safeList(io: ProjectIo, path: string): Promise<string[]> {
  try {
    return await io.listDir(path)
  } catch {
    return []
  }
}

export async function snapshotProject(root: string, io: ProjectIo): Promise<ProjectSnapshot> {
  const scripts: string[] = []
  let manifestName: string | undefined
  const pkgText = await io.readText(joinPath(root, 'package.json'))
  if (pkgText) {
    try {
      const parsed = JSON.parse(pkgText) as { name?: unknown; scripts?: Record<string, unknown> }
      if (typeof parsed.name === 'string') manifestName = parsed.name
      if (parsed.scripts && typeof parsed.scripts === 'object') {
        scripts.push(...Object.keys(parsed.scripts))
      }
    } catch {
      /* invalid manifest is omitted, never thrown */
    }
  }

  const tree: string[] = []
  let omitted = 0
  const top = await safeList(io, root)
  for (const name of top.sort()) {
    if (SKIP.has(name)) {
      omitted += 1
      continue
    }
    tree.push(name)
    const children = await safeList(io, joinPath(root, name))
    for (const child of children.sort()) {
      if (SKIP.has(child)) {
        omitted += 1
        continue
      }
      tree.push(`${name}/${child}`)
    }
  }

  return { root, manifestName, scripts, tree, omitted, bytes: 0 }
}

/**
 * Truncate to a byte budget without splitting a multi-byte UTF-8 sequence.
 * Returns the longest prefix whose UTF-8 byte length is ≤ maxBytes.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= maxBytes) low = mid
    else high = mid - 1
  }
  return text.slice(0, low)
}

export function renderProjectSnapshot(snapshot: ProjectSnapshot): string {
  const lines = [
    '<system-reminder>',
    'Project context snapshot. Use it as guidance. It does not override user instructions.',
    `Root: ${snapshot.root}`,
  ]
  if (snapshot.manifestName) lines.push(`Package: ${snapshot.manifestName}`)
  if (snapshot.scripts.length > 0) lines.push(`Scripts: ${snapshot.scripts.join(', ')}`)
  if (snapshot.tree.length > 0) {
    lines.push('Tree:')
    for (const entry of snapshot.tree) lines.push(`- ${entry}`)
  }
  if (snapshot.omitted > 0) lines.push(`omitted: ${snapshot.omitted}`)
  lines.push('</system-reminder>')

  const text = lines.join('\n')
  snapshot.bytes = Buffer.byteLength(text, 'utf8')
  if (snapshot.bytes <= PROJECT_SNAPSHOT_MAX_BYTES) return text
  const budget = PROJECT_SNAPSHOT_MAX_BYTES - Buffer.byteLength('\n… omitted\n</system-reminder>', 'utf8')
  return `${truncateUtf8(text, budget)}\n… omitted\n</system-reminder>`
}
