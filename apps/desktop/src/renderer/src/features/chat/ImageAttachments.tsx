import type { Tokens } from '@dshd/ui'
import { useCallback, useRef, useState } from 'react'

export interface PendingImage {
  id: string
  name: string
  path: string
  /** object URL for preview */
  url: string
  size: number
}

interface ImageAttachmentsProps {
  tokens: Tokens
  images: PendingImage[]
  onAdd: (images: PendingImage[]) => void
  onRemove: (id: string) => void
  onClear: () => void
  disabled?: boolean
}

/**
 * M2 — drag/drop + paste image intake row.
 * Renders pending-image thumbnails with remove, and a drag overlay that
 * highlights the input area (ChatGPT-style) while files hover over it.
 */
export function ImageAttachments({ tokens, images, onAdd, onRemove, onClear, disabled }: ImageAttachmentsProps): React.JSX.Element {
  const { colors, space, radius, font } = tokens
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const collectFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (list.length === 0) return
      const pending: PendingImage[] = list.map((f) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: f.name || 'paste.png',
        path: (f as File & { path?: string }).path ?? '',
        url: URL.createObjectURL(f),
        size: f.size
      }))
      onAdd(pending)
    },
    [onAdd]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (disabled) return
      collectFiles(e.dataTransfer.files)
    },
    [collectFiles, disabled]
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (disabled) return
      const items = Array.from(e.clipboardData?.items ?? [])
      const images = items.filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile()).filter((f): f is File => f !== null)
      if (images.length > 0) {
        e.preventDefault()
        collectFiles(images)
      }
    },
    [collectFiles, disabled]
  )

  const onPick = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif'
    input.multiple = true
    input.onchange = () => {
      if (input.files) collectFiles(input.files)
    }
    input.click()
  }, [collectFiles])

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault()
        if (disabled) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onPaste={onPaste}
      style={{ position: 'relative' }}
    >
      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm }}>
          {images.map((img) => (
            <div
              key={img.id}
              style={{
                position: 'relative',
                width: 64,
                height: 64,
                borderRadius: radius.sm,
                overflow: 'hidden',
                border: `1px solid ${colors.border}`
              }}
            >
              <img src={img.url} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button
                aria-label={`Remove ${img.name}`}
                onClick={() => {
                  URL.revokeObjectURL(img.url)
                  onRemove(img.id)
                }}
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: 18,
                  height: 18,
                  padding: 0,
                  lineHeight: '16px',
                  fontSize: 12,
                  borderRadius: 9,
                  background: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  border: 0,
                  cursor: 'pointer'
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button onClick={onPick} style={{ width: 64, height: 64, border: `1px dashed ${colors.border}`, background: 'transparent', color: colors.textMuted, borderRadius: radius.sm, cursor: 'pointer' }}>
            ＋
          </button>
        </div>
      )}

      {dragging && (
        <div
          style={{
            position: 'absolute',
            inset: -space.sm,
            borderRadius: radius.md,
            border: `2px dashed ${colors.accent}`,
            background: 'rgba(122,162,247,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <span style={{ color: colors.accent, fontWeight: 600 }}>松开以添加图片</span>
        </div>
      )}

      {images.length > 1 && (
        <button className="mini" onClick={onClear} style={{ marginBottom: space.sm }}>
          清除全部 ({images.length})
        </button>
      )}
      <span style={{ fontSize: font.sizeSm, color: colors.textMuted, marginLeft: space.sm }}>拖拽 / 粘贴 / ＋ 添加图片</span>
    </div>
  )
}
