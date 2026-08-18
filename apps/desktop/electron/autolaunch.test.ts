import { describe, expect, it, vi } from 'vitest'
import { autolaunchEnabled, setAutolaunch, shouldStartHidden, type LoginWindowController } from './autolaunch'
import { buildTrayMenuTemplate } from './tray'

function ctrl(overrides: Partial<LoginWindowController> = {}): LoginWindowController {
  return {
    platform: 'darwin',
    argv: [],
    openedAtLogin: () => false,
    setOpenAtLogin: () => undefined,
    isOpenAtLogin: () => false,
    ...overrides
  }
}

describe('autolaunch (P1)', () => {
  it('hides on macOS when opened at login', () => {
    expect(shouldStartHidden(ctrl({ platform: 'darwin', openedAtLogin: () => true }))).toBe(true)
    expect(shouldStartHidden(ctrl({ platform: 'darwin', openedAtLogin: () => false }))).toBe(false)
  })

  it('hides on Windows only when the --hidden arg is present', () => {
    expect(shouldStartHidden(ctrl({ platform: 'win32', argv: ['--hidden'] }))).toBe(true)
    expect(shouldStartHidden(ctrl({ platform: 'win32', argv: ['--no-hidden'] }))).toBe(false)
  })

  it('does not hide on Linux from argv (no autostart support assumption)', () => {
    expect(shouldStartHidden(ctrl({ platform: 'linux', argv: [] }))).toBe(false)
  })

  it('setAutolaunch delegates to the controller', () => {
    const set = vi.fn()
    const c = ctrl({ setOpenAtLogin: set })
    setAutolaunch(c, true)
    expect(set).toHaveBeenCalledWith(true)
  })

  it('autolaunchEnabled reads the controller', () => {
    expect(autolaunchEnabled(ctrl({ isOpenAtLogin: () => true }))).toBe(true)
    expect(autolaunchEnabled(ctrl({ isOpenAtLogin: () => false }))).toBe(false)
  })
})

describe('tray autolaunch item (P1)', () => {
  const actions = {
    toggleWindow: vi.fn(),
    startRuntime: vi.fn(),
    stopRuntime: vi.fn(),
    openPhonePanel: vi.fn(),
    openLogs: vi.fn(),
    toggleAutolaunch: vi.fn(),
    quit: vi.fn()
  }

  it('shows a checked autolaunch item when enabled', () => {
    const tpl = buildTrayMenuTemplate('ready', actions, true)
    const item = tpl.find((i) => i.label === '✓ 开机自启')
    expect(item).toBeTruthy()
    expect(item?.checked).toBe(true)
  })

  it('shows an unchecked autolaunch item when disabled and toggles', () => {
    const tpl = buildTrayMenuTemplate('idle', actions, false)
    const item = tpl.find((i) => i.label === '开机自启')
    expect(item).toBeTruthy()
    item?.click?.()
    expect(actions.toggleAutolaunch).toHaveBeenCalled()
  })
})
