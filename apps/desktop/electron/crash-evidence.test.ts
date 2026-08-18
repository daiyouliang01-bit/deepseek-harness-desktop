import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CrashEvidence } from './crash-evidence'

describe('CrashEvidence', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-evidence-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function make(now = 1000): CrashEvidence {
    return new CrashEvidence({ dir, appVersion: '0.1.0', now: () => now })
  }

  it('previousRunCrashed is false before any run', () => {
    expect(make().previousRunCrashed()).toBe(false)
    expect(make().readPrevious()).toBeNull()
  })

  it('after beginRun, the marker exists (simulating a crash before clean exit)', () => {
    const ev = make()
    ev.beginRun()
    expect(ev.previousRunCrashed()).toBe(true)
    const prev = ev.readPrevious()
    expect(prev?.appVersion).toBe('0.1.0')
    expect(prev?.startedAt).toBe(1000)
  })

  it('markCleanExit removes the marker (clean shutdown)', () => {
    const ev = make()
    ev.beginRun()
    ev.markCleanExit()
    expect(ev.previousRunCrashed()).toBe(false)
    expect(ev.readPrevious()).toBeNull()
  })

  it('a new instance sees the previous crash as evidence', () => {
    const first = make(1000)
    first.beginRun()
    // simulate crash: no markCleanExit
    const second = make(2000)
    expect(second.previousRunCrashed()).toBe(true)
    expect(second.readPrevious()?.startedAt).toBe(1000)
    // second run starts and exits cleanly → third sees nothing
    second.beginRun()
    second.markCleanExit()
    const third = make(3000)
    expect(third.previousRunCrashed()).toBe(false)
  })

  it('records the dsh version when provided', () => {
    const ev = new CrashEvidence({ dir, appVersion: '0.1.0', dshVersion: () => '0.1.0-rc.7' })
    ev.beginRun()
    expect(ev.readPrevious()?.dshVersion).toBe('0.1.0-rc.7')
  })
})
