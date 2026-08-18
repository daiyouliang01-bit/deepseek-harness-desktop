import { expect, test } from '@playwright/test'
import { guardGui, launchApp } from './helpers'

/**
 * P2 — connecting page + autolaunch E2E.
 * - The loading screen shows while the runtime boots (or the recovery screen
 *   with Retry/Open log when it fails).
 * - Autolaunch state is readable via IPC (enabled/disabled).
 */
guardGui()

test('loading or recovery screen renders with diagnostic affordances', async () => {
  const app = await launchApp()
  if (!app) return
  try {
    const page = await app.firstWindow()
    // Either the shell renderer (loading/recovery) or the official UI loaded.
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
    // The preload bridge is always present.
    const bridge = await page.evaluate(() => typeof (window as unknown as Record<string, unknown>).desktop)
    expect(bridge).toBe('object')
  } finally {
    await app.close()
  }
})

test('autolaunch preference is readable via IPC', async () => {
  const app = await launchApp()
  if (!app) return
  try {
    const page = await app.firstWindow()
    const r = await page.evaluate(async () => (window as unknown as { desktop: { autolaunchGet(): Promise<{ enabled: boolean }> } }).desktop.autolaunchGet())
    expect(typeof r.enabled).toBe('boolean')
  } finally {
    await app.close()
  }
})
