// tests/client/md-render.test.ts
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/client/md-render.ts'

describe('renderMarkdown', () => {
  it('渲染标题', () => { expect(renderMarkdown('# Hi')).toContain('<h1>Hi</h1>') })
  it('渲染粗体与行内代码', () => {
    const html = renderMarkdown('**bold** and `code`')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
  })
  it('渲染代码块', () => {
    const html = renderMarkdown('```ts\nconst x = 1\n```')
    expect(html).toContain('<pre><code')
  })
  it('渲染列表', () => { expect(renderMarkdown('- a\n- b')).toContain('<li>a</li>') })
  it('渲染链接', () => {
    const html = renderMarkdown('[link](https://x.dev)')
    expect(html).toContain('<a href="https://x.dev">link</a>')
  })
  it('HTML 转义', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
  })
})
