import { describe, expect, it } from 'vitest'
import { ApprovalManager } from './approval'
import { AuditLog } from './audit-log'
import { BudgetTracker } from './budget'
import { DEFAULT_POLICY, decide, scopeMatches, STRICT_POLICY } from './policy'

describe('policy decisions', () => {
  it('allows reads, asks for edits/execution/network by default', () => {
    expect(decide(DEFAULT_POLICY, { klass: 'read', scope: 'src/a.ts' })).toBe('allow')
    expect(decide(DEFAULT_POLICY, { klass: 'edit', scope: 'src/a.ts' })).toBe('ask')
    expect(decide(DEFAULT_POLICY, { klass: 'execute', scope: undefined })).toBe('ask')
    expect(decide(DEFAULT_POLICY, { klass: 'network', scope: undefined })).toBe('ask')
  })

  it('defaults to deny for unknown classes', () => {
    expect(decide(DEFAULT_POLICY, { klass: 'mystery' as never, scope: undefined })).toBe('deny')
  })

  it('strict policy denies execution outright', () => {
    expect(decide(STRICT_POLICY, { klass: 'execute' })).toBe('deny')
  })

  it('scoped rules only match their scope', () => {
    const policy = {
      rules: [
        { klass: 'edit' as const, decision: 'ask' as const },
        { klass: 'edit' as const, decision: 'allow' as const, scopePattern: 'docs/*' }
      ]
    }
    expect(decide(policy, { klass: 'edit', scope: 'docs/guide.md' })).toBe('allow')
    expect(decide(policy, { klass: 'edit', scope: 'src/main.ts' })).toBe('ask')
  })

  it('scopeMatches handles exact and wildcard', () => {
    expect(scopeMatches('docs/*', 'docs/guide.md')).toBe(true)
    expect(scopeMatches('docs/*', 'src/a.ts')).toBe(false)
    expect(scopeMatches('a.ts', 'a.ts')).toBe(true)
    expect(scopeMatches('a.ts', undefined)).toBe(false)
  })
})

describe('approval workflow', () => {
  let now = 1_000_000
  const am = () => new ApprovalManager(() => now)

  it('one-time approval grants the exact scope once', () => {
    const a = am()
    const id = a.request({ id: 'r1', action: 'write', klass: 'edit', scope: 'src/a.ts' })
    expect(a.listPending()).toHaveLength(1)
    a.approve(id, 'one-time')
    expect(a.isGranted('edit', 'src/a.ts')).toBe(true)
    expect(a.isGranted('edit', 'src/b.ts')).toBe(false)
    a.revoke('edit', 'src/a.ts')
    expect(a.isGranted('edit', 'src/a.ts')).toBe(false)
  })

  it('workspace approval covers all scopes of the class', () => {
    const a = am()
    const id = a.request({ id: 'r2', action: 'write', klass: 'edit', scope: 'src/a.ts' })
    a.approve(id, 'workspace')
    expect(a.isGranted('edit', 'src/anywhere/else.ts')).toBe(true)
  })

  it('session approval expires at session end', () => {
    const a = am()
    const id = a.request({ id: 'r3', action: 'run', klass: 'execute' })
    a.approve(id, 'session')
    expect(a.isGranted('execute')).toBe(true)
    a.endSession()
    expect(a.isGranted('execute')).toBe(false)
  })

  it('explicit TTL expiry revokes the grant', () => {
    const a = am()
    const id = a.request({ id: 'r4', action: 'run', klass: 'execute' })
    a.approve(id, 'session', 5_000)
    expect(a.isGranted('execute')).toBe(true)
    now += 6_000
    expect(a.isGranted('execute')).toBe(false)
  })

  it('deny removes the request without granting', () => {
    const a = am()
    const id = a.request({ id: 'r5', action: 'rm', klass: 'execute' })
    a.deny(id)
    expect(a.listPending()).toHaveLength(0)
    expect(a.isGranted('execute')).toBe(false)
  })
})

describe('audit log', () => {
  it('records entries with filters and caps', () => {
    const log = new AuditLog(3)
    for (let i = 0; i < 5; i++) {
      log.record({ actor: 'agent', action: `act${i}`, klass: 'execute', outcome: 'approved' })
    }
    expect(log.list()).toHaveLength(3) // capped
    log.record({ actor: 'user', action: 'approve', klass: 'execute', outcome: 'approved' })
    expect(log.list({ actor: 'user' })).toHaveLength(1)
    expect(log.list({ klass: 'execute' })).toHaveLength(3) // cap still enforced
    expect(log.list({ actor: 'agent' })).toHaveLength(2) // oldest agent entries dropped
  })
})

describe('budget guardrail', () => {
  it('blocks new calls once the token budget is exhausted', () => {
    const tracker = new BudgetTracker({ maxTokens: 100, blockNewCalls: true })
    expect(tracker.remaining()).toBe(100)
    tracker.record(60)
    expect(tracker.canExecute()).toBe(true)
    tracker.record(60)
    expect(tracker.isBlocked()).toBe(true)
    expect(tracker.canExecute()).toBe(false)
    expect(tracker.remaining()).toBe(0)
  })

  it('tracks usage without blocking when disabled', () => {
    const tracker = new BudgetTracker({ maxTokens: 10, blockNewCalls: false })
    tracker.record(20)
    expect(tracker.isBlocked()).toBe(true)
    expect(tracker.canExecute()).toBe(true) // blockNewCalls=false → informational only
  })

  it('unlimited budget reports null remaining and never blocks', () => {
    const tracker = new BudgetTracker({ blockNewCalls: true })
    expect(tracker.remaining()).toBeNull()
    tracker.record(9_999)
    expect(tracker.canExecute()).toBe(true)
  })

  it('resets for a new session', () => {
    const tracker = new BudgetTracker({ maxTokens: 10, blockNewCalls: true })
    tracker.record(10)
    expect(tracker.isBlocked()).toBe(true)
    tracker.reset()
    expect(tracker.isBlocked()).toBe(false)
    expect(tracker.remaining()).toBe(10)
  })
})
