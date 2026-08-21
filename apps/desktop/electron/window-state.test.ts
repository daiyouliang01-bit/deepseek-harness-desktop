import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadWindowState,
  sanitizeWindowState,
  saveWindowState,
  windowStatePath,
  type DisplayArea
} from './window-state'

const MAIN: DisplayArea = { x: 0, y: 0, width: 1440, height: 900 }
const EXTERNAL: DisplayArea = { x: 1440, y: -600, width: 1920, height: 1080 }

afterEach(() => {
  rmSync(join(tmpdir(), 'dshd-winstate-'), { recursive: true, force: true })
})

describe('sanitizeWindowState', () => {
  it('returns the default for garbage input', () => {
    expect(sanitizeWindowState(undefined, [MAIN])).toEqual({ width: 1200, height: 800 })
    expect(sanitizeWindowState('nope', [MAIN])).toEqual({ width: 1200, height: 800 })
    expect(sanitizeWindowState({ width: 'big' }, [])).toEqual({ width: 1200, height: 800 })
  })

  it('clamps sizes below the window minimums', () => {
    expect(sanitizeWindowState({ width: 100, height: 50 }, [MAIN])).toEqual({ width: 800, height: 600 })
    expect(sanitizeWindowState({ width: 2000.7, height: 1000.2 }, [MAIN])).toEqual({
      width: 2001,
      height: 1000
    })
  })

  it('keeps a position that intersects a display work area', () => {
    const s = sanitizeWindowState({ width: 1000, height: 700, x: 1500, y: -500 }, [MAIN, EXTERNAL])
    expect(s.x).toBe(1500)
    expect(s.y).toBe(-500)
  })

  it('drops a position fully off-screen (monitor unplugged) but keeps the size', () => {
    const s = sanitizeWindowState({ width: 1000, height: 700, x: 8000, y: 8000 }, [MAIN])
    expect(s.x).toBeUndefined()
    expect(s.y).toBeUndefined()
    expect(s.width).toBe(1000)
    expect(s.height).toBe(700)
  })

  it('keeps the maximized flag', () => {
    expect(sanitizeWindowState({ width: 1200, height: 800, maximized: true }, [MAIN]).maximized).toBe(true)
  })
})

describe('load/save round-trip', () => {
  it('persists and reloads state; missing file yields default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshd-winstate-'))
    try {
      expect(loadWindowState(dir, [MAIN])).toEqual({ width: 1200, height: 800 })
      saveWindowState(dir, { width: 1400, height: 900, x: 10, y: 20, maximized: false })
      const reloaded = loadWindowState(dir, [MAIN])
      expect(reloaded).toEqual({ width: 1400, height: 900, x: 10, y: 20, maximized: false })
      expect(readFileSync(windowStatePath(dir), 'utf8')).toContain('"width":1400')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a corrupted file yields the default instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshd-winstate-'))
    try {
      const { writeFileSync } = require('node:fs') as typeof import('node:fs')
      const { mkdirSync } = require('node:fs') as typeof import('node:fs')
      mkdirSync(join(dir, 'config'), { recursive: true })
      writeFileSync(join(dir, 'config', 'window-state.json'), '{not json')
      expect(loadWindowState(dir, [MAIN])).toEqual({ width: 1200, height: 800 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
