import { expect, test } from '@playwright/test'
import { guardGui, launchApp } from './helpers'

/**
 * P2 — update-status E2E: the update bridge reports a valid phase in any
 * environment (unsupported in dev, or idle/up-to-date when packaged).
 */
guardGui()

test('update status is a valid phase', async () => {
  const app = await launchApp()
  if (!app) return
  try {
    const page = await app.firstWindow()
    const state = await page.evaluate(async () => (window as unknown as { desktop: { updateGetState(): Promise<{ status: string }> } }).desktop.updateGetState())
    const valid = ['unsupported', 'idle', 'checking', 'available', 'downloading', 'downloaded', 'up-to-date', 'error']
    expect(valid).toContain(state.status)
  } finally {
    await app.close()
  }
})
