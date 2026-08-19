import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLoop } from '../../packages/harness-adapter/src/session-loop'

function runNode(script: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('close', (code) => resolve({ ok: code === 0, output }))
  })
}

describe('coding-agent isolated verify', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('fails then succeeds across real node commands and persists the phase', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cag-verify-'))
    dirs.push(cwd)
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }))
    const loop = new SessionLoop()
    loop.noteUserTurn('s-live')
    loop.noteMutation('s-live', 'edit')
    const ports = {
      async readText(path: string) {
        try {
          return readFileSync(path, 'utf8')
        } catch {
          return null // lockfiles / memory may be absent
        }
      },
      writeFile(path: string, data: string) {
        writeFileSync(path, data, 'utf8')
      },
      mkdirp(path: string) {
        mkdirSync(path, { recursive: true })
      },
      async runCommand() {
        return runNode('process.exit(1)')
      },
    }
    const first = await loop.finishTurn('s-live', cwd, ports)
    expect(first.type).toBe('steer')
    expect(loop.view('s-live').phase).toBe('working')

    loop.noteMutation('s-live', 'edit')
    ports.runCommand = async () => runNode('process.exit(0)')
    const second = await loop.finishTurn('s-live', cwd, ports)
    expect(second).toMatchObject({ type: 'status', phase: 'completed' })
    const saved = JSON.parse(readFileSync(join(cwd, '.dsh', 'tasks', 's-live.json'), 'utf8')) as {
      phase: string
      lastVerify: Array<{ ok: boolean }>
    }
    expect(saved.phase).toBe('completed')
    expect(saved.lastVerify[0]?.ok).toBe(true)
  })
})
