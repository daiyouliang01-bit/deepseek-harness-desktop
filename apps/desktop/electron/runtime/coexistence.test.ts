import { describe, expect, it } from 'vitest'
import { classifyCoexisting, detectCoexistingInstances } from './coexistence'

const PS_SAMPLE = `USER   PID  %CPU %MEM      VSZ    RSS   TT  STAT STARTED      TIME COMMAND
litong  15597   1.5  2.7 446710032 455040 s001  S+   11:33下午   4:22.11 node /Users/litong/node_modules/.bin/../@deepseek-ai/dsh/lib/bin.js web
litong  47471   0.0  1.1 446362992 181008   ??  S    12:41上午   0:01.12 node /Users/litong/node_modules/.bin/../@deepseek-ai/dsh/lib/bin.js --patch /app/resources/desktop-tools.patch.yml --profile web --host 127.0.0.1 --port 35880
litong  47560   0.0  1.1 446363088 180640   ??  S    12:42上午   0:01.12 node /Users/litong/node_modules/.bin/../@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 0
litong  99999   0.0  0.1  123456 1234    ??  S     1:00下午   0:00.00 /Applications/Cursor.app/Contents/MacOS/Cursor
`

describe('detectCoexistingInstances (R2/R19, report-only)', () => {
  it('classifies app-signature orphans vs manual instances vs unrelated', () => {
    const found = detectCoexistingInstances(
      { appSignature: 'desktop-tools.patch.yml', dshMarkers: ['bin.js'] },
      () => PS_SAMPLE
    )
    expect(found).toHaveLength(3) // 15597, 47471, 47560 — Cursor excluded
    const { appOrphans, manual } = classifyCoexisting(found)
    expect(appOrphans.map((i) => i.pid)).toEqual([47471])
    expect(manual.map((i) => i.pid).sort()).toEqual([15597, 47560].sort())
  })

  it('never reports ledger-managed pids', () => {
    const found = detectCoexistingInstances(
      { appSignature: 'desktop-tools.patch.yml', dshMarkers: ['bin.js'], managedPids: new Set([47471, 15597]) },
      () => PS_SAMPLE
    )
    expect(found.map((i) => i.pid)).toEqual([47560])
  })

  it('returns empty on scanner failure (no crash)', () => {
    const found = detectCoexistingInstances({}, () => {
      throw new Error('boom')
    })
    expect(found).toHaveLength(0)
  })
})
