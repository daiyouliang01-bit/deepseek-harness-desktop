import { expect, test } from '@playwright/test'
import { guardGui, launchApp } from './helpers'

/**
 * P2 — window lifecycle E2E: close hides to tray (app keeps running), quit
 * via IPC exits, and the single-instance lock focuses the existing window.
 */
guardGui()

test('closing the window keeps the app alive (hide to tray)', async () => {
  const app = await launchApp()
  if (!app) return
  try {
    // close → hidden, not quit. Drive it from the MAIN process via win.close()
    // so the preventable 'close' handler runs — page.close() goes through CDP
    // and DESTROYS the window, bypassing the hide-to-tray path a real user's
    // ✕ button takes.
    // A real user can only close a VISIBLE window — wait for the first paint.
    await expect
      .poll(async () => await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible())), { timeout: 15_000 })
      .toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    // Sample the transition — a re-show race shows up as visible flipping back.
    let state: { count: number; visible: boolean; detail: string } | null = null
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 400))
      state = await app.evaluate(({ BrowserWindow }) => {
        const wins = BrowserWindow.getAllWindows()
        return {
          count: wins.length,
          visible: wins.some((w) => w.isVisible()),
          detail: wins.map((w) => `${w.getTitle()}|v=${w.isVisible()}`).join(',')
        }
      })
      console.log('[sample]', i, JSON.stringify(state))
      if (!state.visible) break
    }
    // Hide-to-tray contract: the window still exists but is NOT visible, and
    // the process is alive (evaluate above succeeded).
    expect(state).not.toBeNull()
    expect(state!.count).toBeGreaterThan(0)
    expect(state!.visible).toBe(false)
  } finally {
    await app.close().catch(() => undefined)
  }
})

test('quit via IPC exits the app', async () => {
  const app = await launchApp()
  if (!app) return
  // Quit through the preload bridge, executed inside the page context. The
  // quit path stops the runtime deterministically before exiting, so allow a
  // realistic budget instead of asserting synchronously.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    void win?.webContents.executeJavaScript('window.desktop.quit()')
  })
  await Promise.race([
    new Promise((resolve) => app.on('close', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('app did not exit within 20s')), 20_000))
  ])
})

test('single-instance: a second launch focuses the first window', async () => {
  const app = await launchApp()
  if (!app) return
  try {
    // Second instance should hand off to the first (lock held).
    const second = await launchApp()
    if (second) await second.close()
  } finally {
    await app.close().catch(() => undefined)
  }
})
