import { describe, expect, it, vi } from 'vitest'
import { buildAppMenuTemplate } from './menu'
import { RuntimeNotifier, type NotificationBackend } from './notifications'
import { GlobalShortcutManager, type ShortcutBackend } from './shortcuts'
import { buildTrayMenuTemplate } from './tray'

describe('tray menu template', () => {
  const actions = {
    toggleWindow: vi.fn(),
    startRuntime: vi.fn(),
    stopRuntime: vi.fn(),
    openLogs: vi.fn(),
    quit: vi.fn()
  }

  it('shows Stop Runtime while running', () => {
    const tpl = buildTrayMenuTemplate('ready', actions)
    expect(tpl.find((i) => i.label === 'Runtime: ready')).toBeTruthy()
    const stop = tpl.find((i) => i.label === 'Stop Runtime')
    expect(stop).toBeTruthy()
    stop?.click?.()
    expect(actions.stopRuntime).toHaveBeenCalled()
  })

  it('shows Start Runtime while stopped/error', () => {
    const tpl = buildTrayMenuTemplate('error', actions)
    const start = tpl.find((i) => i.label === 'Start Runtime')
    expect(start).toBeTruthy()
    start?.click?.()
    expect(actions.startRuntime).toHaveBeenCalled()
  })

  it('wires toggle/logs/quit', () => {
    const tpl = buildTrayMenuTemplate('idle', actions)
    tpl.find((i) => i.label === 'Show / Hide Window')?.click?.()
    tpl.find((i) => i.label === 'Open Logs')?.click?.()
    tpl.find((i) => i.label === 'Quit DeepSeek Harness Desktop')?.click?.()
    expect(actions.toggleWindow).toHaveBeenCalled()
    expect(actions.openLogs).toHaveBeenCalled()
    expect(actions.quit).toHaveBeenCalled()
  })
})

describe('runtime notifier', () => {
  function backend(): NotificationBackend & { calls: Array<[string, string]> } {
    const calls: Array<[string, string]> = []
    return {
      isSupported: () => true,
      show: (t, b) => calls.push([t, b]),
      calls
    }
  }

  it('notifies once on ready, then on error and stopped', () => {
    const be = backend()
    const n = new RuntimeNotifier(be)
    n.handleStatus({ state: 'starting' })
    expect(be.calls).toHaveLength(0)
    n.handleStatus({ state: 'ready', ready: { url: 'http://127.0.0.1:1', port: 1, startupMs: 10 } })
    n.handleStatus({ state: 'ready', ready: { url: 'http://127.0.0.1:2', port: 2, startupMs: 20 } }) // re-ready (restart)
    expect(be.calls.filter(([t]) => t === 'DeepSeek Harness Desktop')).toHaveLength(1)
    n.handleStatus({ state: 'error', lastError: 'boom' })
    expect(be.calls.some(([, b]) => b === 'boom')).toBe(true)
    n.handleStatus({ state: 'stopped' })
    expect(be.calls.some(([t]) => t === 'Runtime stopped')).toBe(true)
  })

  it('is silent when notifications are unsupported', () => {
    const be = backend()
    be.isSupported = () => false
    const n = new RuntimeNotifier(be)
    n.handleStatus({ state: 'error', lastError: 'x' })
    expect(be.calls).toHaveLength(0)
  })
})

describe('global shortcut manager', () => {
  function backend(): ShortcutBackend & { registered: Set<string>; fired: number; cb: () => void } {
    const registered = new Set<string>()
    const be: ShortcutBackend & { registered: Set<string>; fired: number; cb: () => void } = {
      registered,
      fired: 0,
      cb: () => undefined,
      register: (acc, cb) => {
        registered.add(acc)
        be.cb = cb
        return true
      },
      unregister: (acc) => {
        registered.delete(acc)
      },
      unregisterAll: () => {
        registered.clear()
      }
    }
    return be
  }

  it('registers the accelerator and fires the summon callback', () => {
    const be = backend()
    const summoned = vi.fn()
    const m = new GlobalShortcutManager(be, summoned)
    expect(m.register()).toBe(true)
    expect(be.registered.has('CommandOrControl+Shift+Space')).toBe(true)
    be.cb()
    expect(summoned).toHaveBeenCalledTimes(1)
  })

  it('unregisters cleanly and tolerates double-register', () => {
    const be = backend()
    const m = new GlobalShortcutManager(be, vi.fn())
    expect(m.register()).toBe(true)
    expect(m.register()).toBe(true) // idempotent
    m.unregister()
    expect(be.registered.size).toBe(0)
  })

  it('returns false when the key is taken', () => {
    const be = backend()
    be.register = () => false
    const m = new GlobalShortcutManager(be, vi.fn())
    expect(m.register()).toBe(false)
  })
})

describe('app menu template', () => {
  const actions = {
    openCustomShell: vi.fn(),
    openOfficialUI: vi.fn(),
    reload: vi.fn(),
    quit: vi.fn()
  }

  it('exposes View items for shell ↔ official UI switching', () => {
    const tpl = buildAppMenuTemplate(actions)
    const view = tpl.find((m) => m.label === 'View')
    const shell = view?.submenu?.find((i) => i.label === 'Custom Shell (preview)')
    const official = view?.submenu?.find((i) => i.label === 'Official Web UI')
    shell?.click?.()
    official?.click?.()
    expect(actions.openCustomShell).toHaveBeenCalled()
    expect(actions.openOfficialUI).toHaveBeenCalled()
  })
})
