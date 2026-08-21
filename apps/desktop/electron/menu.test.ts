import { describe, expect, it, vi } from 'vitest'
import { buildAppMenuTemplate, type AppMenuItem } from './menu'

function actions() {
  return { openCustomShell: vi.fn(), openOfficialUI: vi.fn(), reload: vi.fn(), quit: vi.fn() }
}

function viewItems(template: AppMenuItem[]): AppMenuItem[] {
  const view = template.find((m) => m.label === 'View')
  return view?.submenu ?? []
}

describe('buildAppMenuTemplate', () => {
  it('hides developer entries outside dev mode', () => {
    const view = viewItems(buildAppMenuTemplate(actions(), { devMode: false }))
    expect(view.some((m) => m.label === 'Custom Shell (preview)')).toBe(false)
    expect(view.some((m) => m.label === 'Official Web UI')).toBe(false)
    expect(view.some((m) => m.role === 'toggleDevTools')).toBe(false)
    expect(view.some((m) => m.label === 'Reload')).toBe(true)
  })

  it('keeps developer entries in dev mode', () => {
    const view = viewItems(buildAppMenuTemplate(actions(), { devMode: true }))
    expect(view.some((m) => m.label === 'Custom Shell (preview)')).toBe(true)
    expect(view.some((m) => m.label === 'Official Web UI')).toBe(true)
    expect(view.some((m) => m.role === 'toggleDevTools')).toBe(true)
  })

  it('defaults to production posture when options are omitted', () => {
    const view = viewItems(buildAppMenuTemplate(actions()))
    expect(view.some((m) => m.role === 'toggleDevTools')).toBe(false)
  })
})
