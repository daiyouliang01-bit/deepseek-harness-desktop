// tests/client/tabs.test.ts
import { describe, expect, it } from 'vitest'
import { kindForPath, openTab, closeTab } from '../../src/client/tabs.ts'
import type { PreviewTab } from '../../src/client/tabs.ts'

describe('kindForPath', () => {
  it('识别各类型', () => {
    expect(kindForPath('/a/b.md')).toBe('md')
    expect(kindForPath('/a/b.pdf')).toBe('pdf')
    expect(kindForPath('/a/b.png')).toBe('image')
    expect(kindForPath('/a/b.html')).toBe('html')
    expect(kindForPath('/a/b.docx')).toBe('docx')
    expect(kindForPath('/a/b.ts')).toBe('code')
    expect(kindForPath('/a/b.txt')).toBe('txt')
    expect(kindForPath('/a/b.xyz')).toBe('binary')
  })
})

describe('openTab', () => {
  it('追加新标签并激活', () => {
    const r = openTab([], { path: '/a.md', name: 'a.md', kind: 'md' })
    expect(r.tabs.length).toBe(1)
    expect(r.activeId).toBe(r.tabs[0]!.id)
  })
  it('已存在则仅激活不重复', () => {
    const first = openTab([], { path: '/a.md', name: 'a.md', kind: 'md' })
    const r = openTab(first.tabs, { path: '/a.md', name: 'a.md', kind: 'md' })
    expect(r.tabs.length).toBe(1)
  })
  it('超过 8 个拒绝', () => {
    let state: PreviewTab[] = []
    for (let i = 0; i < 8; i++) state = openTab(state, { path: `/f${i}`, name: `f${i}`, kind: 'txt' }).tabs
    const r = openTab(state, { path: '/f9', name: 'f9', kind: 'txt' })
    expect(r.tabs.length).toBe(8)
  })
})

describe('closeTab', () => {
  it('关闭非激活标签保留激活', () => {
    const a = openTab([], { path: '/a', name: 'a', kind: 'txt' })
    const b = openTab(a.tabs, { path: '/b', name: 'b', kind: 'txt' })
    const r = closeTab(b.tabs, b.activeId, a.tabs[0]!.id)
    expect(r.tabs.length).toBe(1)
    expect(r.activeId).toBe(b.activeId)
  })
  it('关闭激活标签激活相邻', () => {
    const a = openTab([], { path: '/a', name: 'a', kind: 'txt' })
    const b = openTab(a.tabs, { path: '/b', name: 'b', kind: 'txt' })
    const c = openTab(b.tabs, { path: '/c', name: 'c', kind: 'txt' })
    const r = closeTab(c.tabs, c.activeId, c.activeId)
    expect(r.tabs.length).toBe(2)
    expect(r.activeId).not.toBeNull()
  })
})
