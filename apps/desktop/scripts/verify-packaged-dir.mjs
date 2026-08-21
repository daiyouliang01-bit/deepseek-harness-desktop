/* Verify the packaged desktop app uses the isolated data dir (~/.dsh-desktop). */
import { _electron as electron } from 'playwright'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const exe = '/Users/litong/Documents/DeepSeekHarnessDesktop/apps/desktop/release/mac-arm64/DeepSeek Harness Desktop.app/Contents/MacOS/DeepSeek Harness Desktop'
  const app = await electron.launch({ executablePath: exe })
  try {
    const page = await app.firstWindow()
    console.log('[1] window title:', await page.title())

    // Wait for the official UI (packaged app loads it on runtime ready).
    let url = ''
    for (let i = 0; i < 30; i += 1) {
      url = page.url()
      if (url.includes('35880')) break
      await sleep(1000)
    }
    await sleep(2000)
    console.log('[2] window url:', url)

    // Probe session.list on the packaged app's dsh.
    const RID = 'rpc-' + Date.now()
    const res = await fetch('http://127.0.0.1:35880/api/session.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:35880' },
      body: JSON.stringify({ type: 'client-request', rpcId: RID, method: 'session.list', payload: { args: {} } }),
    }).then((r) => r.json())
    const items = res.result?.value?.items ?? []
    console.log('[3] 35880 sessions:', items.length)
    items.slice(0, 3).forEach((i) => console.log('     -', i.sessionId.slice(0, 16), i.cwd))

    // Check the child dsh process env for DSH_HOME.
    const children = app.process().children() ?? []
    console.log('[4] child processes:', children.length)
    for (const child of children) {
      const cmd = child.spawnargs?.join(' ') ?? ''
      if (cmd.includes('bin.js') || cmd.includes('dsh')) {
        const env = child.env ?? {}
        console.log('     dsh env DSH_HOME =', env.DSH_HOME ?? '(unset)')
      }
    }
  } finally {
    await app.close().catch(() => undefined)
  }
}

main().catch((err) => {
  console.error('verify failed:', err)
  process.exit(1)
})
