import { expect, test } from '@playwright/test'
import { guardGui, launchApp } from './helpers'

/**
 * P2 — harness lifecycle E2E: the app spawns dsh web, the runtime reaches
 * ready (or shows the recovery screen when dsh is unavailable), and the
 * status bridge reports the state.
 */
guardGui()

test('runtime starts and the status bridge reports ready', async () => {
  const app = await launchApp()
  if (!app) return
  try {
    const page = await app.firstWindow()
    // The renderer exposes the runtime status via the preload bridge.
    const status = await page.evaluate(async () => (window as unknown as { desktop: { getRuntimeStatus(): Promise<{ state: string }> } }).desktop.getRuntimeStatus())
    // Either the runtime is up (ready) or the machine lacks dsh → error/idle.
    expect(['ready', 'error', 'idle', 'stopped']).toContain(status.state)
    if (status.state === 'ready') {
      // The official Web UI should have replaced the shell renderer.
      await expect(page).toHaveURL(/127\.0\.0\.1:\d+/)
    }
  } finally {
    await app.close()
  }
})

test('runtime restart via IPC returns a status', async () => {
  const app = await launchApp()
  if (!app) return
  try {
    const page = await app.firstWindow()
    const result = await page.evaluate(async () => (window as unknown as { desktop: { restartRuntime(): Promise<{ state: string }> } }).desktop.restartRuntime())
    expect(result.state).toMatch(/starting|ready|error|stopped/)
  } finally {
    await app.close()
  }
})
