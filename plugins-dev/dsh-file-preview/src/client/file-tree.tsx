// src/client/file-tree.tsx
import { useState, useCallback } from 'react'
import type { ReactElement } from 'react'
import { fpCall } from './api.ts'

interface DirEntry { name: string; path: string; isDir: boolean; size: number; mtime: number }

function FolderRow({ entry, depth, onOpen }: { entry: DirEntry; depth: number; onOpen(p: string): void }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toggle = useCallback(async () => {
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (children === null) {
      try {
        const r = await fpCall<DirEntry[]>('listDir', { path: entry.path })
        setChildren(r)
      } catch (e) { setError(String(e)) }
    }
  }, [expanded, children, entry.path])
  return (
    <div>
      <button
        onClick={toggle}
        style={{ paddingLeft: depth * 12, display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13, paddingTop: 3, paddingBottom: 3 }}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>📁</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
      </button>
      {expanded && children && children.map((c) => c.isDir
        ? <FolderRow key={c.path} entry={c} depth={depth + 1} onOpen={onOpen} />
        : <FileRow key={c.path} entry={c} depth={depth + 1} onOpen={onOpen} />)}
      {expanded && error && <div style={{ paddingLeft: depth * 12 + 16, color: 'var(--color-danger, #f87171)', fontSize: 12 }}>{error}</div>}
    </div>
  )
}

function FileRow({ entry, depth, onOpen }: { entry: DirEntry; depth: number; onOpen(p: string): void }): ReactElement {
  return (
    <button
      onClick={() => onOpen(entry.path)}
      title={entry.name}
      style={{ paddingLeft: depth * 12 + 18, display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13, paddingTop: 3, paddingBottom: 3 }}
    >
      <span>📄</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
    </button>
  )
}

export function FileTree({ root, onOpen }: { root: string; onOpen(path: string): void }): ReactElement {
  const [rootEntry] = useState<DirEntry>({ name: root.split('/').pop() || root, path: root, isDir: true, size: 0, mtime: 0 })
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <FolderRow entry={rootEntry} depth={0} onOpen={onOpen} />
    </div>
  )
}
