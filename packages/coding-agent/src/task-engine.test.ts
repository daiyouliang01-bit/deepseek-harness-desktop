import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IllegalTaskTransition, TaskEngine } from './task-engine'

describe('TaskEngine transitions', () => {
  it('starts idle and accepts the legal happy path', () => {
    const engine = new TaskEngine()
    expect(engine.phase()).toBe('idle')
    engine.transition('planning')
    engine.transition('working')
    engine.transition('verifying')
    engine.transition('completed')
    expect(engine.phase()).toBe('completed')
    engine.transition('idle')
    expect(engine.phase()).toBe('idle')
  })

  it('allows verifying to fail then reset', () => {
    const engine = new TaskEngine()
    engine.transition('working')
    engine.transition('verifying')
    engine.transition('failed')
    expect(engine.phase()).toBe('failed')
    engine.transition('idle')
    expect(engine.phase()).toBe('idle')
  })

  it('rejects illegal jumps', () => {
    const engine = new TaskEngine()
    expect(() => engine.transition('completed')).toThrow(IllegalTaskTransition)
    expect(engine.phase()).toBe('idle')
  })
})

describe('TaskEngine persistence', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  it('round-trips phase through an atomic file write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-engine-'))
    dirs.push(dir)
    const path = join(dir, 'task.json')
    const engine = new TaskEngine()
    engine.transition('planning')
    engine.persist(path, (target, data) => writeFileSync(target, data, 'utf8'))

    const saved = JSON.parse(readFileSync(path, 'utf8')) as { version: number; phase: string }
    expect(saved.version).toBe(1)
    expect(saved.phase).toBe('planning')

    const restored = new TaskEngine()
    restored.restore(path, (target) => readFileSync(target, 'utf8'))
    expect(restored.phase()).toBe('planning')
  })

  it('stays idle when the persist file is missing', () => {
    const engine = new TaskEngine()
    engine.restore('/no/such/task.json', () => null)
    expect(engine.phase()).toBe('idle')
  })
})
