import { describe, expect, it } from 'vitest'
import { interpretCommandResult, parsePersistedTask, SessionLoop, type LoopPorts } from './session-loop'

function memoryPorts(
  files: Record<string, string>,
  runs: Array<{ cmd: string; ok: boolean; output: string }>,
): LoopPorts & { files: Record<string, string> } {
  return {
    async readText(path: string) {
      return Object.hasOwn(files, path) ? files[path] : null
    },
    writeFile(path: string, data: string) {
      files[path] = data
    },
    mkdirp() {},
    async runCommand(cmd: string) {
      const hit = runs.find((item) => item.cmd === cmd)
      return hit ?? { ok: false, output: `missing ${cmd}` }
    },
    files,
  }
}

describe('interpretCommandResult', () => {
  it('treats a non-zero bash exit marker as failure even when isError is false', () => {
    expect(
      interpretCommandResult({
        isError: false,
        content: 'tests failed\n[exit code: 1]',
      }),
    ).toEqual({ ok: false, output: 'tests failed\n[exit code: 1]' })
  })

  it('treats exit code 0 as success', () => {
    expect(interpretCommandResult({ isError: false, content: 'ok\n[exit code: 0]' }).ok).toBe(true)
  })
})

describe('parsePersistedTask', () => {
  it('reads phase and verifyOk from a v1 task file', () => {
    expect(
      parsePersistedTask(
        JSON.stringify({ version: 1, phase: 'failed', lastVerify: [{ ok: false }] }),
      ),
    ).toEqual({ phase: 'failed', verifyOk: false })
  })

  it('returns null for corrupt payloads', () => {
    expect(parsePersistedTask('{')).toBeNull()
    expect(parsePersistedTask(JSON.stringify({ version: 2, phase: 'working' }))).toBeNull()
  })
})

describe('SessionLoop', () => {
  it('does not verify when no mutation happened', async () => {
    const loop = new SessionLoop()
    loop.noteUserTurn('s1')
    const ports = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest' } }) },
      [{ cmd: 'npm run test', ok: true, output: 'ok' }],
    )
    const action = await loop.finishTurn('s1', '/repo', ports)
    expect(action).toEqual({ type: 'none' })
    expect(loop.view('s1').phase).toBe('working')
  })

  it('runs verify after an edit and completes when scripts pass', async () => {
    const loop = new SessionLoop()
    loop.noteUserTurn('s1')
    loop.noteMutation('s1', 'edit')
    const ports = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest' } }) },
      [{ cmd: 'npm run test', ok: true, output: 'ok' }],
    )
    const action = await loop.finishTurn('s1', '/repo', ports)
    expect(action.type).toBe('status')
    expect(loop.view('s1').phase).toBe('completed')
    expect(loop.view('s1').lastVerify?.[0]?.ok).toBe(true)
    expect(ports.files['/repo/.dsh/tasks/s1.json']).toContain('completed')
  })

  it('steers a fix when verify fails and attempts remain', async () => {
    const loop = new SessionLoop()
    loop.noteUserTurn('s1')
    loop.noteMutation('s1', 'write')
    const ports = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest' } }) },
      [{ cmd: 'npm run test', ok: false, output: 'boom' }],
    )
    const action = await loop.finishTurn('s1', '/repo', ports)
    expect(action).toMatchObject({ type: 'steer' })
    if (action.type === 'steer') expect(action.content).toContain('boom')
    expect(loop.view('s1').phase).toBe('working')
  })

  it('marks failed after two unsuccessful auto-fix attempts', async () => {
    const loop = new SessionLoop()
    loop.noteUserTurn('s1')
    const ports = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest' } }) },
      [{ cmd: 'npm run test', ok: false, output: 'boom' }],
    )
    loop.noteMutation('s1', 'edit')
    await loop.finishTurn('s1', '/repo', ports)
    loop.noteMutation('s1', 'edit')
    await loop.finishTurn('s1', '/repo', ports)
    loop.noteMutation('s1', 'edit')
    const third = await loop.finishTurn('s1', '/repo', ports)
    expect(third).toMatchObject({ type: 'status', phase: 'failed' })
    expect(loop.view('s1').phase).toBe('failed')
  })

  it('skips verify when there are no known scripts', async () => {
    const loop = new SessionLoop()
    loop.noteUserTurn('s1')
    loop.noteMutation('s1', 'str_replace_editor')
    const ports = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { start: 'node .' } }) },
      [],
    )
    const action = await loop.finishTurn('s1', '/repo', ports)
    expect(action).toEqual({ type: 'none' })
    expect(loop.view('s1').phase).toBe('working')
  })

  it('resets completed → working on a new user turn so the next task verifies', async () => {
    const loop = new SessionLoop()
    loop.noteUserTurn('s1')
    loop.noteMutation('s1', 'edit')
    const ok = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest' } }) },
      [{ cmd: 'npm run test', ok: true, output: 'ok' }],
    )
    await loop.finishTurn('s1', '/repo', ok)
    expect(loop.view('s1').phase).toBe('completed')

    // Second task: user turn + edit → verify must run again.
    const fail = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest' } }) },
      [{ cmd: 'npm run test', ok: false, output: 'regression' }],
    )
    loop.noteUserTurn('s1')
    loop.noteMutation('s1', 'edit')
    const action = await loop.finishTurn('s1', '/repo', fail)
    expect(action).toMatchObject({ type: 'steer' })
    if (action.type === 'steer') expect(action.content).toContain('regression')
    expect(loop.view('s1').phase).toBe('working')
  })

  it('runs verify only once when finishTurn is called concurrently', async () => {
    const loop = new SessionLoop()
    loop.noteUserTurn('s1')
    loop.noteMutation('s1', 'edit')
    let runs = 0
    const ports = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest' } }) },
      [],
    )
    ports.runCommand = async () => {
      runs += 1
      return { ok: true, output: 'ok' }
    }
    const [first, second] = await Promise.all([
      loop.finishTurn('s1', '/repo', ports),
      loop.finishTurn('s1', '/repo', ports),
    ])
    expect(runs).toBe(1)
    expect(first).toBe(second)
    expect(loop.view('s1').phase).toBe('completed')
  })

  it('persists via atomic tmp+rename when the port is available', async () => {
    const loop = new SessionLoop()
    loop.noteUserTurn('s1')
    loop.noteMutation('s1', 'edit')
    const written: Record<string, string> = {}
    const renames: Array<[string, string]> = []
    const ports = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest' } }) },
      [{ cmd: 'npm run test', ok: true, output: 'ok' }],
    )
    ports.writeFile = (path, data) => {
      written[path] = data
    }
    ports.rename = (from: string, to: string) => {
      renames.push([from, to])
      written[to] = written[from]
      delete written[from]
    }
    await loop.finishTurn('s1', '/repo', ports)
    expect(renames).toHaveLength(1)
    expect(renames[0][1]).toBe('/repo/.dsh/tasks/s1.json')
    expect(written['/repo/.dsh/tasks/s1.json']).toContain('completed')
  })

  it('dispose drops per-session state', async () => {
    const loop = new SessionLoop()
    loop.noteUserTurn('s1')
    loop.noteMutation('s1', 'edit')
    expect(loop.sessionCount).toBe(1)
    loop.dispose('s1')
    expect(loop.sessionCount).toBe(0)
    loop.noteUserTurn('s1')
    expect(loop.view('s1').phase).toBe('working')
  })

  it('view never creates a session entry', () => {
    const loop = new SessionLoop()
    expect(loop.view('nobody')).toEqual({ phase: 'idle', lastVerify: null })
    expect(loop.sessionCount).toBe(0)
  })

  it('resets the auto-fix budget when a completed task starts anew', async () => {
    const loop = new SessionLoop()
    // Task 1: three failed attempts exhaust the budget → failed (2 auto-fixes).
    loop.noteUserTurn('s1')
    loop.noteMutation('s1', 'edit')
    const fail = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest' } }) },
      [{ cmd: 'npm run test', ok: false, output: 'boom1' }],
    )
    await loop.finishTurn('s1', '/repo', fail) // attempt 1 → steer (working)
    expect(loop.view('s1').phase).toBe('working')
    loop.noteMutation('s1', 'edit')
    await loop.finishTurn('s1', '/repo', fail) // attempt 2 → steer (working)
    loop.noteMutation('s1', 'edit')
    await loop.finishTurn('s1', '/repo', fail) // attempt 3 → failed (budget exhausted)
    expect(loop.view('s1').phase).toBe('failed')

    // Task 2: a fresh user turn resets the budget — first failure steers,
    // it does NOT jump straight to failed.
    const ports = memoryPorts(
      { '/repo/package.json': JSON.stringify({ scripts: { test: 'vitest' } }) },
      [{ cmd: 'npm run test', ok: false, output: 'boom2' }],
    )
    loop.noteUserTurn('s1')
    loop.noteMutation('s1', 'edit')
    const action = await loop.finishTurn('s1', '/repo', ports)
    expect(action).toMatchObject({ type: 'steer' })
    expect(loop.view('s1').phase).toBe('working')
  })
})
