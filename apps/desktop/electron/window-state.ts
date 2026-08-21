/** P2 — remember window size/position across launches. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface SavedWindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

/** Work-area rectangle of one display (subset of Electron's Display). */
export interface DisplayArea {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_WIDTH = 800
export const MIN_HEIGHT = 600
export const DEFAULT_WIDTH = 1200
export const DEFAULT_HEIGHT = 800

/**
 * Clamp a persisted window state to something sane for the CURRENT display
 * set: sizes at least the window minimums, and a position kept only when the
 * window rectangle still intersects some display's work area (guards against
 * a monitor being unplugged between runs — a window restored fully off-screen
 * is unrecoverable for the user).
 */
export function sanitizeWindowState(raw: unknown, displays: DisplayArea[]): SavedWindowState {
  const fallback: SavedWindowState = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  if (typeof raw !== 'object' || raw === null) return fallback
  const r = raw as Record<string, unknown>
  const width =
    typeof r.width === 'number' && Number.isFinite(r.width) ? Math.max(MIN_WIDTH, Math.round(r.width)) : DEFAULT_WIDTH
  const height =
    typeof r.height === 'number' && Number.isFinite(r.height) ? Math.max(MIN_HEIGHT, Math.round(r.height)) : DEFAULT_HEIGHT
  const state: SavedWindowState = { width, height }
  if (typeof r.maximized === 'boolean') state.maximized = r.maximized
  if (typeof r.x !== 'number' || typeof r.y !== 'number' || !Number.isFinite(r.x) || !Number.isFinite(r.y)) return state
  if (displays.length === 0) return state
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  const intersects = displays.some(
    (d) => x < d.x + d.width && x + width > d.x && y < d.y + d.height && y + height > d.y
  )
  if (intersects) {
    state.x = x
    state.y = y
  }
  return state
}

export function windowStatePath(userDataDir: string): string {
  return join(userDataDir, 'config', 'window-state.json')
}

/** Load + sanitize; any read/parse failure yields the default state. */
export function loadWindowState(userDataDir: string, displays: DisplayArea[]): SavedWindowState {
  try {
    const raw: unknown = JSON.parse(readFileSync(windowStatePath(userDataDir), 'utf8'))
    return sanitizeWindowState(raw, displays)
  } catch {
    return sanitizeWindowState(undefined, displays)
  }
}

/** Best-effort persist; failures are swallowed (a missed save is cosmetic). */
export function saveWindowState(userDataDir: string, state: SavedWindowState): void {
  try {
    const p = windowStatePath(userDataDir)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}
