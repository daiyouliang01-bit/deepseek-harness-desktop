// src/client/renderers.tsx
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { TabKind } from './tabs.ts'
import { renderMarkdown } from './md-render.ts'
import { fpCall } from './api.ts'

export function previewUrl(path: string): string {
  return `/preview/${encodeURIComponent(path)}`
}

function Loader(): ReactElement {
  return <div style={{ padding: 24, color: 'var(--color-text-muted, #999)', fontSize: 13 }}>加载中…</div>
}

function ErrorView({ message }: { message: string }): ReactElement {
  return (
    <div style={{ padding: 24, color: 'var(--color-danger, #f87171)', fontSize: 13 }}>
      无法预览：{message}
    </div>
  )
}

function TextContent({ kind, path }: { kind: TabKind; path: string }): ReactElement {
  const [state, setState] = useState<{ text: string; truncated: boolean } | { error: string } | null>(null)
  useEffect(() => {
    let alive = true
    setState(null)
    fpCall<{ text: string; truncated: boolean }>('readText', { path })
      .then((r) => { if (alive) setState(r) })
      .catch((e: unknown) => { if (alive) setState({ error: String(e) }) })
    return () => { alive = false }
  }, [path])
  if (state === null) return <Loader />
  if ('error' in state) return <ErrorView message={state.error} />
  const body = kind === 'md' ? renderMarkdown(state.text) : state.text
  const html = kind === 'md'
    ? <div dangerouslySetInnerHTML={{ __html: body }} style={{ padding: 16, fontSize: 14, lineHeight: 1.7 }} />
    : <pre style={{ padding: 16, fontSize: 13, overflow: 'auto', lineHeight: 1.6, margin: 0 }}>{body}{state.truncated ? '\n…(已截断)' : ''}</pre>
  return html
}

function DocxContent({ path }: { path: string }): ReactElement {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fpCall<{ html?: string; error?: string }>('docxToHtml', { path })
      .then((res) => {
        if (!alive) return
        // res: { html } | { error }
        if (res.html) setHtml(res.html)
        else setError(res.error ?? '转换失败')
      })
      .catch((e: unknown) => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [path])
  if (error) return <ErrorView message={error} />
  if (html === null) return <Loader />
  return <div dangerouslySetInnerHTML={{ __html: html }} style={{ padding: 16, overflow: 'auto' }} />
}

export function ContentView({ kind, path }: { kind: TabKind; path: string }): ReactElement {
  switch (kind) {
    case 'md':
    case 'txt':
    case 'code':
      return <TextContent kind={kind} path={path} />
    case 'pdf':
      return <iframe src={previewUrl(path)} style={{ width: '100%', height: '100%', border: 'none' }} title={path} />
    case 'image':
      return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', overflow: 'auto' }}>
        <img src={previewUrl(path)} alt={path} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    case 'html':
      return <iframe sandbox="" src={previewUrl(path)} style={{ width: '100%', height: '100%', border: 'none' }} title={path} />
    case 'docx':
      return <DocxContent path={path} />
    case 'binary':
      return <div style={{ padding: 24, fontSize: 13, color: 'var(--color-text-muted, #999)' }}>
        此文件类型不支持内联预览。可在工具栏点击「用默认应用打开」。
      </div>
    default:
      return <ErrorView message={`未知文件类型：${kind}`} />
  }
}
