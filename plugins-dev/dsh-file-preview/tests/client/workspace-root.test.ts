import { describe, expect, it } from 'vitest'
import { pickWorkspaceRoot } from '../../src/client/workspace-root.ts'

describe('pickWorkspaceRoot', () => {
  it('优先使用当前会话目录', () => {
    expect(pickWorkspaceRoot('/workspace/session', '/workspace/recent')).toBe('/workspace/session')
  })

  it('没有当前会话时回退到最近工作区', () => {
    expect(pickWorkspaceRoot(undefined, '/workspace/recent')).toBe('/workspace/recent')
  })

  it('两个来源都为空时不返回根目录', () => {
    expect(pickWorkspaceRoot('  ', undefined)).toBe('')
  })
})
