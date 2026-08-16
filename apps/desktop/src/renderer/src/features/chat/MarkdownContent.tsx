import type { Tokens } from '@dshd/ui'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown renderer for assistant/user message content, with GFM support
 * (tables, strikethrough, task lists) and dark-themed code blocks.
 */
export function MarkdownContent({ content, tokens }: { content: string; tokens: Tokens }): React.JSX.Element {
  const { colors, radius, font, space } = tokens
  return (
    <div
      style={{
        fontSize: 14,
        lineHeight: 1.6,
        color: colors.text
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? '')
            if (isBlock) {
              return (
                <pre
                  style={{
                    background: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radius.sm,
                    padding: `${space.sm}px ${space.md}px`,
                    overflowX: 'auto',
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    fontFamily: font.mono
                  }}
                >
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              )
            }
            return (
              <code
                style={{
                  background: colors.surfaceAlt,
                  borderRadius: 4,
                  padding: '1px 5px',
                  fontFamily: font.mono,
                  fontSize: 12.5
                }}
                {...props}
              >
                {children}
              </code>
            )
          },
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', margin: `${space.sm}px 0` }}>
              <table style={{ borderCollapse: 'collapse', border: `1px solid ${colors.border}` }}>{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th style={{ border: `1px solid ${colors.border}`, padding: '4px 10px', background: colors.surfaceAlt, textAlign: 'left' }}>{children}</th>
          ),
          td: ({ children }) => <td style={{ border: `1px solid ${colors.border}`, padding: '4px 10px' }}>{children}</td>,
          a: ({ children, href }) => (
            <a href={href} style={{ color: colors.accent }} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
