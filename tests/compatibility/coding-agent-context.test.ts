import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HarnessProcess } from '../../apps/desktop/electron/runtime/harness-process'
import { ensureCodingAgentLinked } from '../../apps/desktop/electron/runtime/coding-agent-installer'
import { RpcClient } from '../../apps/desktop/electron/adapter/rpc-client'

function dshAvailable(): boolean {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    // Honor the same binary override the spawn path uses; a bare 'dsh' on
    // PATH is only one of the ways these suites can run.
    const bin = process.env.DSHD_DSH_BIN ?? 'dsh'
    execFileSync(bin, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const PATCH = join(__dirname, '../../apps/desktop/resources/desktop-tools.patch.yml')
const APP_ROOT = join(__dirname, '../../apps/desktop')

function linkIfExists(from: string, to: string): void {
  if (!existsSync(from)) return
  mkdirSync(dirname(to), { recursive: true })
  try {
    symlinkSync(from, to)
  } catch {
    /* already linked */
  }
}

describe.skipIf(!dshAvailable())('coding-agent live context', () => {
  let home: string
  let repo: string
  let hp: HarnessProcess
  let client: RpcClient
  let previousHome: string | undefined
  const logs: string[] = []

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'dshd-cag-home-'))
    repo = mkdtempSync(join(tmpdir(), 'dshd-cag-repo-'))
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'smoke-demo', scripts: { test: 'vitest' } }),
    )
    mkdirSync(join(repo, '.dsh'), { recursive: true })
    writeFileSync(join(repo, '.dsh', 'memory.md'), 'use pnpm in this fixture\n')

    const realHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    linkIfExists(join(realHome, 'settings.yaml'), join(home, 'settings.yaml'))
    linkIfExists(join(realHome, '.credentials.yaml'), join(home, '.credentials.yaml'))
    linkIfExists(join(realHome, '.xai-oauth-auth.json'), join(home, '.xai-oauth-auth.json'))
    if (existsSync(join(realHome, 'xai-oauth'))) {
      linkIfExists(join(realHome, 'xai-oauth'), join(home, 'xai-oauth'))
    }
    // Reuse the machine's already-composed web profile so configured
    // providers (e.g. xai-oauth) exist. Sessions still live under `home`.
    linkIfExists(join(realHome, 'profiles', 'web'), join(home, 'profiles', 'web'))

    previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home

    const linked = ensureCodingAgentLinked(home, APP_ROOT)
    expect(linked).toBeTruthy()

    hp = new HarnessProcess({
      readyTimeoutMs: 60_000,
      topLevelArgs: ['--patch', PATCH],
      dshBin: process.env.DSHD_DSH_BIN ?? 'dsh',
      onOutput(_stream, line) {
        logs.push(line)
      },
    })
    const info = await hp.start()
    client = new RpcClient({ baseUrl: info.url, timeoutMs: 60_000 })
  }, 180_000)

  afterAll(async () => {
    await hp?.stop()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }, 30_000)

  it('official skill.list discovers the three bundled skills', async () => {
    const created = await client.unary<{ sessionId: string }>('session.create', { cwd: repo })
    const listed = await client.unary<{ skills: Array<{ name: string }> }>('skill.list', {
      sessionId: created.sessionId,
    })
    const names = listed.skills.map((skill) => skill.name)
    expect(names).toEqual(expect.arrayContaining([
      'project-onboarding',
      'verify-before-complete',
      'small-safe-edits',
    ]))
  }, 60_000)

  it('first model request history contains the project context snapshot', async () => {
    const created = await client.unary<{ sessionId: string }>('session.create', { cwd: repo })
    await client.unary('session.prompt', {
      sessionId: created.sessionId,
      mode: 'steer',
      content: [{ type: 'text', text: 'reply with the word ok' }],
    })

    const deadline = Date.now() + 90_000
    let blob = ''
    while (Date.now() < deadline) {
      const history = await client.unary<{
        events: Array<{ event: { type: string; data?: Record<string, unknown> } }>
      }>('session.history', { sessionId: created.sessionId, maxMessages: 80 })
      blob = JSON.stringify(history.events)
      if (blob.includes('smoke-demo') && blob.includes('system-reminder')) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    const pluginLog = existsSync(join(home, 'coding-agent.log'))
      ? readFileSync(join(home, 'coding-agent.log'), 'utf8')
      : `missing-log applied=${existsSync(join(home, 'coding-agent-applied'))}`
    expect(blob, `history missing project context. pluginLog=${pluginLog}`).toContain('smoke-demo')
    expect(blob).toContain('system-reminder')
  }, 120_000)
})
