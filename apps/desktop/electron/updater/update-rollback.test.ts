import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UpdateRollback } from './update-rollback'

describe('UpdateRollback', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-rollback-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function make(now = 1000): UpdateRollback {
    return new UpdateRollback({ dir, now: () => now })
  }

  it('no pending marker → no rollback suggestion', () => {
    const r = make()
    expect(r.evaluate(false)).toEqual({ pendingInstall: null, rollbackSuggested: false })
    expect(r.evaluate(true)).toEqual({ pendingInstall: null, rollbackSuggested: false })
  })

  it('pending install + clean boot → clears marker, no suggestion', () => {
    const r = make()
    r.markPendingInstall('0.2.0')
    const st = r.evaluate(false)
    expect(st.pendingInstall?.version).toBe('0.2.0')
    expect(st.rollbackSuggested).toBe(false)
    expect(r.readPending()).toBeNull() // cleared
  })

  it('pending install + crash → rollback suggested, marker retained', () => {
    const r = make()
    r.markPendingInstall('0.2.0')
    const st = r.evaluate(true)
    expect(st.rollbackSuggested).toBe(true)
    expect(st.pendingInstall?.version).toBe('0.2.0')
    // marker retained so the user can act (rollback) or retry
    expect(r.readPending()?.version).toBe('0.2.0')
  })

  it('markPendingInstall records version and timestamp', () => {
    const r = make(5000)
    r.markPendingInstall('1.0.0')
    expect(r.readPending()).toEqual({ version: '1.0.0', markedAt: 5000 })
  })

  it('tolerates a corrupt pending file', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs')
    writeFileSync(join(dir, 'pending-update.json'), '{broken')
    expect(make().readPending()).toBeNull()
    expect(make().evaluate(false).rollbackSuggested).toBe(false)
  })
})
