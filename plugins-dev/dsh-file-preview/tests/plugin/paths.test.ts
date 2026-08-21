// tests/plugin/paths.test.ts
import { describe, expect, it, beforeEach } from 'vitest'
import { assertAllowedPath, addAllowedRoot, contentTypeForPath } from '../../src/plugin/paths.ts'

describe('assertAllowedPath', () => {
  beforeEach(() => { addAllowedRoot('/Users/t/ws') })

  it('允许根内的绝对路径', () => {
    expect(assertAllowedPath('/Users/t/ws/a.md')).toBe('/Users/t/ws/a.md')
  })
  it('拒绝相对路径', () => {
    expect(() => assertAllowedPath('a.md')).toThrow('FP_PATH_DENIED')
  })
  it('拒绝越界（.. 穿越）', () => {
    expect(() => assertAllowedPath('/Users/t/ws/../secret.txt')).toThrow('FP_PATH_DENIED')
  })
  it('拒绝根外路径', () => {
    expect(() => assertAllowedPath('/etc/passwd')).toThrow('FP_PATH_DENIED')
  })
})

describe('contentTypeForPath', () => {
  it('映射常见类型', () => {
    expect(contentTypeForPath('/a/b.md')).toBe('text/markdown')
    expect(contentTypeForPath('/a/b.pdf')).toBe('application/pdf')
    expect(contentTypeForPath('/a/b.png')).toBe('image/png')
    expect(contentTypeForPath('/a/b.html')).toBe('text/html')
    expect(contentTypeForPath('/a/b.ts')).toBe('text/plain; charset=utf-8')
  })
  it('未知扩展名回退 octet-stream', () => {
    expect(contentTypeForPath('/a/b.xyz')).toBe('application/octet-stream')
  })
  it('无扩展名回退 octet-stream', () => {
    expect(contentTypeForPath('/a/README')).toBe('application/octet-stream')
  })
})
