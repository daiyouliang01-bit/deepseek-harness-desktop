/** Task 4.2 — workspace-scoped file model (pure; real FS access stays in main). */

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: FileNode[]
}

/** Build a tree from a flat path list (sorted, dirs first, recursive). */
export function buildTree(paths: string[]): FileNode[] {
  const root: FileNode = { name: '', path: '', type: 'dir', children: [] }

  for (const p of paths.sort()) {
    const parts = p.split('/').filter(Boolean)
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const existing = node.children?.find((c) => c.name === part)
      if (existing) {
        node = existing
      } else {
        const child: FileNode = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          type: isLast ? 'file' : 'dir',
          children: isLast ? undefined : []
        }
        node.children ??= []
        node.children.push(child)
        node = child
      }
    }
  }
  return sortNodes(root.children ?? [])
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes
    .sort(compareNodes)
    .map((n) => (n.children ? { ...n, children: sortNodes(n.children) } : n))
}

function compareNodes(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name)
}

/** Filter the tree to a path prefix (workspace scoping). */
export function withinWorkspace(tree: FileNode[], rootPrefix: string): FileNode[] {
  const prefix = rootPrefix.replace(/\/+$/, '')
  const out: FileNode[] = []
  for (const node of tree) {
    if (node.path === prefix || node.path.startsWith(prefix + '/')) {
      out.push(stripPrefix(node, prefix))
    }
  }
  return out
}

function stripPrefix(node: FileNode, prefix: string): FileNode {
  const rel = node.path === prefix ? '' : node.path.slice(prefix.length + 1)
  return {
    ...node,
    path: rel,
    children: node.children?.map((c) => stripPrefix(c, prefix))
  }
}

/** Walk a tree depth-first, yielding every file path. */
export function walkFiles(tree: FileNode[]): string[] {
  const out: string[] = []
  const visit = (nodes: FileNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'file') out.push(n.path)
      if (n.children) visit(n.children)
    }
  }
  visit(tree)
  return out
}
