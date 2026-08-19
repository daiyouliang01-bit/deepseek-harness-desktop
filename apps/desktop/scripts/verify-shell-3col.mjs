/* Verify the Claude-style three-column shell renders (DSH_FORCE_SHELL=1). */
import { _electron as electron } from 'playwright'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DSH_FORCE_SHELL: '1' },
  })
  try {
    const page = await app.firstWindow()
    console.log('[1] window title:', await page.title())

    // Wait for the three-column shell to render (skip onboarding gate first).
    for (let i = 0; i < 25; i += 1) {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '')
      if (body.includes('Skip for now')) {
        await page.getByText('Skip for now').first().click().catch(() => undefined)
      }
      if (body.includes('+ New chat') && !body.includes('runtime not ready')) break
      await sleep(1200)
    }
    await sleep(2000)

    console.log('[2] body head:', (await page.evaluate(() => document.body.innerText.slice(0, 400))).replace(/\n+/g, ' | '))
    await page.screenshot({ path: '/tmp/dsh-shell-3col.png' })
    console.log('[3] screenshot saved /tmp/dsh-shell-3col.png')

    // Settings → archived section.
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('button[title="Settings"]')
      if (btn) {
        btn.click()
        return true
      }
      return false
    })
    console.log('[4] settings rail clicked:', clicked)
    await sleep(1500)
    await page.screenshot({ path: '/tmp/dsh-shell-settings.png' })
    console.log('[5] settings screenshot saved /tmp/dsh-shell-settings.png')
  } finally {
    await app.close().catch(() => undefined)
  }
}

main().catch((err) => {
  console.error('verify failed:', err)
  process.exit(1)
})
