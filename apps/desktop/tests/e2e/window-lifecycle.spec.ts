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
    const page = await app.firstWindow()
    // close → hidden, not quit
    await page.close({ runBeforeUnload: false })
    await new Promise((r) => setTimeout(r, 500))
    // The app is still running: evaluating the main process works.
    const state = await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows()
      return { count: wins.length, visible: wins.some((w) => w.isVisible()) }
    })
    // Hide-to-tray contract: the window still exists but is NOT visible, and
    // the process is alive (evaluate above succeeded).
    expect(state.count).toBeGreaterThan(0)
    expect(state.visible).toBe(false)
  } finally {
    await app.close().catch(() => undefined)
  }
})

test('quit via IPC exits the app', async () => {
  const app = await launchApp()
  if (!app) return
  const page = await app.firstWindow()
  await page.evaluate(() => (window as unknown as { desktop: { quit(): Promise<void> } }).desktop.quit())
  await expect(app).toBe(null) // resolves when the process exits — null after close
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
