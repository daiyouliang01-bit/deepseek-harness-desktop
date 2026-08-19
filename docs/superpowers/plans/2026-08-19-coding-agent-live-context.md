# Coding Agent Live Context Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. TDD is required. Do not modify any `@deepseek-ai/*` package. Steps use checkbox (`- [ ]`) syntax.

**Status:** v1.2 implemented (inline). Isolated live smoke passed: first-request history contains `smoke-demo` inside a system-reminder; `skill.list` returns the three bundled skills. Host row must be a patch `insert`, not an id overlay.

**Goal:** Make the already-built Coding Agent modules actually reach a live session: first model request contains a project snapshot + memory, and the three official-format skills appear in the DSH skill catalog.

**Architecture:** Keep `@dshd/coding-agent` pure. Put all “should I inject?” decisions in `@dshd/harness-adapter` `prepareProjectContextMessage()`. The host plugin only adapts official Cordis events to those ports and wraps text with `createUserMessage` from `@deepseek-ai/dsh-llm` (allowed only inside the plugin JS that already runs in the dsh process). Do not use `agent.inject()` for the first request.

**Tech Stack:** existing Vitest packages, host plugin JS, official `createUserMessage`, official skill filesystem roots.

**Spec:** `docs/superpowers/plans/2026-08-19-coding-agent-mvp.md` (phase 1 done) + architecture analysis v1.2.

## Global Constraints

- Do not modify `@deepseek-ai/*` source or shipped presets.
- `@dshd/coding-agent` and `prepareProjectContextMessage` must not import `@deepseek-ai/*`.
- Host plugin may import `@deepseek-ai/dsh-llm` `createUserMessage` only.
- Fold context in `agent/pre-step` **after** `await next()`. Never `inject()` for first-request context (`inject` can miss a batch already claimed).
- Fail-safe: missing cwd, unreadable root, timeout, parse failure → skip injection. Do not reject the step.
- Do not re-inject AGENTS.md body.
- Phone-sync / phone-settings / pin-gate stay unmodified.
- Do not expand official-row patches; the `coding-agent` row already exists.
- Live verifier / task-state machine / custom ChatView are **out of this plan**.

## Why this slice

Phase 1 left `apps/desktop/plugins/dsh-coding-agent/lib/index.js` as a no-op and left skills on disk where official `dsh-skill-filesystem` cannot see them. Without this slice the modules exist only in unit tests.

## File map

- Create: `packages/harness-adapter/src/process-bridge.ts`
- Create: `packages/harness-adapter/src/process-bridge.test.ts`
- Create: `apps/desktop/plugins/dsh-coding-agent/lib/process-bridge.js` (bundled from the TS file)
- Create: `apps/desktop/scripts/bundle-coding-agent-plugin.mjs`
- Modify: `apps/desktop/plugins/dsh-coding-agent/lib/index.js` — real `apply()`
- Modify: `apps/desktop/plugins/dsh-coding-agent/package.json` — add `./process-bridge` export
- Modify: `apps/desktop/electron/runtime/coding-agent-installer.ts` — also link skills
- Modify: `apps/desktop/electron/runtime/coding-agent-installer.test.ts`
- Modify: `apps/desktop/plugins/plugin-sandbox.test.mjs` — host plugin still publishes no service
- Do not modify: official Harness, phone plugins, `desktop-tools.patch.yml` permission block

---

### Task 1: Pure process bridge

**Files:**
- Create: `packages/harness-adapter/src/process-bridge.ts`
- Create: `packages/harness-adapter/src/process-bridge.test.ts`
- Modify: `packages/harness-adapter/src/index.ts` — re-export the function

**Interfaces:**
- Consumes: `snapshotProject`, `renderProjectSnapshot`, `readMemory` from `@dshd/coding-agent`
- Produces:

```ts
export type SnapshotPorts = {
  readText(path: string): Promise<string | null>
  listDir(path: string): Promise<string[]>
}

export type PreStepInput = {
  sessionId: string
  cwd: string | undefined
  alreadyInjected: Set<string>
}

export async function prepareProjectContextMessage(
  input: PreStepInput,
  ports: SnapshotPorts,
): Promise<{ content: string } | null>
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { prepareProjectContextMessage } from './process-bridge'

function memoryPorts(files: Record<string, string>) {
  return {
    async readText(path: string) {
      return Object.hasOwn(files, path) ? files[path] : null
    },
    async listDir(path: string) {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const names = new Set<string>()
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue
        const name = key.slice(prefix.length).split('/')[0]
        if (name) names.add(name)
      }
      return [...names]
    },
  }
}

describe('prepareProjectContextMessage', () => {
  it('returns null when cwd is missing', async () => {
    const injected = new Set<string>()
    const result = await prepareProjectContextMessage(
      { sessionId: 's1', cwd: undefined, alreadyInjected: injected },
      memoryPorts({}),
    )
    expect(result).toBeNull()
    expect(injected.size).toBe(0)
  })

  it('renders package name and memory once per session', async () => {
    const injected = new Set<string>()
    const ports = memoryPorts({
      '/repo/package.json': JSON.stringify({ name: 'demo-app', scripts: { test: 'vitest' } }),
      '/repo/.dsh/memory.md': 'use pnpm',
    })
    const first = await prepareProjectContextMessage(
      { sessionId: 's1', cwd: '/repo', alreadyInjected: injected },
      ports,
    )
    const second = await prepareProjectContextMessage(
      { sessionId: 's1', cwd: '/repo', alreadyInjected: injected },
      ports,
    )
    expect(first?.content).toContain('<system-reminder>')
    expect(first?.content).toContain('demo-app')
    expect(first?.content).toContain('use pnpm')
    expect(first?.content).not.toContain('AGENTS.md')
    expect(second).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @dshd/harness-adapter test`
Expected: FAIL `Cannot find module './process-bridge'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { readMemory, renderProjectSnapshot, snapshotProject } from '@dshd/coding-agent'
import { join } from 'node:path'
import type { SnapshotPorts, PreStepInput } from './process-bridge-types'

export async function prepareProjectContextMessage(
  input: PreStepInput,
  ports: SnapshotPorts,
): Promise<{ content: string } | null> {
  if (!input.cwd) return null
  if (input.alreadyInjected.has(input.sessionId)) return null
  try {
    const snapshot = await snapshotProject(input.cwd, ports)
    const rawMemory = await ports.readText(join(input.cwd, '.dsh', 'memory.md'))
    const memory = rawMemory ? readMemory(rawMemory) : ''
    const body = renderProjectSnapshot(snapshot)
    const content = memory
      ? `${body}\n\n<system-reminder>\nProject memory:\n${memory}\n</system-reminder>`
      : body
    input.alreadyInjected.add(input.sessionId)
    return { content }
  } catch {
    return null
  }
}
```

Mark injected **only after a successful render**. A thrown snapshot must not burn the session id (so a later retry can succeed).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @dshd/harness-adapter test && pnpm --filter @dshd/coding-agent test`
Expected: PASS

---

### Task 2: Bundle the bridge into the host plugin

The dsh child loads ESM from `~/.dsh/profiles/web/node_modules/@dshd/coding-agent-host`. It cannot import workspace TypeScript.

**Files:**
- Create: `apps/desktop/scripts/bundle-coding-agent-plugin.mjs`
- Create: `apps/desktop/plugins/dsh-coding-agent/lib/process-bridge.js` (generated, committed)
- Modify: `apps/desktop/package.json` scripts — `"bundle:coding-agent": "node scripts/bundle-coding-agent-plugin.mjs"`

- [ ] **Step 1: Write a failing check**

Add to `apps/desktop/plugins/plugin-sandbox.test.mjs`:

```js
test('coding-agent plugin ships a bundled process-bridge', async () => {
  const file = join(root, 'dsh-coding-agent/lib/process-bridge.js')
  const src = readFileSync(file, 'utf8')
  assert.match(src, /prepareProjectContextMessage/)
  assert.doesNotMatch(src, /@deepseek-ai\//)
})
```

- [ ] **Step 2: Run it and confirm missing file**

Run: `node --test apps/desktop/plugins/plugin-sandbox.test.mjs`
Expected: FAIL ENOENT `process-bridge.js`

- [ ] **Step 3: Write the bundler and generate the file**

```js
import { buildSync } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
buildSync({
  absWorkingDir: root,
  entryPoints: [join(root, '../../packages/harness-adapter/src/process-bridge.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(root, 'plugins/dsh-coding-agent/lib/process-bridge.js'),
  packages: 'bundle',
})
```

`esbuild` is already available via the desktop Vite toolchain. If a direct import fails, use `pnpm --filter @dshd/desktop exec esbuild ...` from the script.

- [ ] **Step 4: Re-run sandbox test**

Expected: PASS, and the generated file contains no `@deepseek-ai/` string.

---

### Task 3: Host plugin folds context on first pre-step

**Files:**
- Modify: `apps/desktop/plugins/dsh-coding-agent/lib/index.js`

**Interfaces:**
- Consumes: `prepareProjectContextMessage` from `./process-bridge.js`
- Consumes: `createUserMessage` from `@deepseek-ai/dsh-llm`
- Produces: a Cordis plugin that publishes **no** service

Official message shape (from `dsh-agent-instructions`):

```js
createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'plugin', plugin: 'coding-agent' },
})
```

- [ ] **Step 1: Extend the sandbox test**

```js
test('coding-agent host apply registers a pre-step listener and does not reject', async () => {
  const mod = await import(pathToFileURL(join(root, 'dsh-coding-agent/lib/index.js')).href + `?t=${Date.now()}`)
  const seen = []
  const ctx = {
    on(name, fn) {
      seen.push(name)
      return () => {}
    },
  }
  const plugin = mod.default
  assert.equal(plugin.inject, undefined)
  plugin.apply(ctx)
  assert.ok(seen.includes('agent/pre-step'))
})
```

- [ ] **Step 2: Run and confirm it fails**

Expected: FAIL `seen.includes('agent/pre-step')` because `apply()` is still a no-op.

- [ ] **Step 3: Implement apply()**

```js
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prepareProjectContextMessage } from './process-bridge.js'

const alreadyInjected = new Set()

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function listDir(path) {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

export default {
  name: 'coding-agent',
  apply(ctx) {
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      try {
        if (!decision || decision.kind !== 'enter') return decision
        const cwd = payload.agent?.session?.header?.cwd
        const sessionId = payload.agent?.id
        if (!sessionId) return decision
        const extra = await Promise.race([
          prepareProjectContextMessage(
            { sessionId, cwd, alreadyInjected },
            { readText, listDir },
          ),
          new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
        ])
        if (!extra) return decision
        const message = createUserMessage({
          content: [{ type: 'text', text: extra.content }],
          source: { kind: 'plugin', plugin: 'coding-agent' },
        })
        return { kind: 'enter', messages: [...decision.messages, message] }
      } catch {
        return decision
      }
    })
  },
}
```

Hard numbers: snapshot I/O timeout **2000ms**. Listener errors never reject the step.

cwd field: `payload.agent.session.header.cwd` (official session header). If the live object uses a different leaf, fail-safe skip. Confirm during the isolated smoke in Task 5; if the leaf differs, only this plugin file changes.

- [ ] **Step 4: Re-run sandbox + adapter tests**

Expected: PASS

---

### Task 4: Link official-format skills into `$DSH_HOME/skills`

Official `dsh-skill-filesystem` rank 400 reads `<dshHome>/skills/<name>/SKILL.md`. Repo files in `apps/desktop/skills/` are invisible until linked.

**Files:**
- Modify: `apps/desktop/electron/runtime/coding-agent-installer.ts`
- Modify: `apps/desktop/electron/runtime/coding-agent-installer.test.ts`

**Interfaces:**
- Produces: `ensureCodingAgentSkillsLinked(dshHome: string, appRoot: string): string[]`

- [ ] **Step 1: Write the failing test**

```ts
it('symlinks bundled skills into the user DSH skills root', () => {
  mkdirSync(join(appRoot, 'skills', 'project-onboarding'), { recursive: true })
  writeFileSync(join(appRoot, 'skills', 'project-onboarding', 'SKILL.md'), '---\nname: project-onboarding\n---\n')
  const linked = ensureCodingAgentSkillsLinked(home, appRoot)
  expect(linked).toContain(join(home, 'skills', 'project-onboarding'))
  expect(existsSync(join(home, 'skills', 'project-onboarding', 'SKILL.md'))).toBe(true)
})
```

- [ ] **Step 2: Run desktop installer tests**

Expected: FAIL `ensureCodingAgentSkillsLinked is not exported`

- [ ] **Step 3: Minimal implementation**

Link `appRoot/skills/<name>` → `dshHome/skills/<name>`. Refresh stale symlinks. Skip names that already exist as a real directory (do not overwrite user skills). Never throw.

Call it from `ensureCodingAgentLinked` or from `main/index.ts` next to the existing installer call.

Why touch `main/index.ts` only if the new function is not invoked from `ensureCodingAgentLinked`. Prefer calling it inside `ensureCodingAgentLinked` so main does not need another edit.

- [ ] **Step 4: Re-run installer + sandbox tests**

Expected: PASS

---

### Task 5: Isolated smoke against real dsh (optional but recommended)

**Files:**
- Create: `tests/compatibility/coding-agent-context.test.ts`

Use `DSH_HOME` under `/tmp`, spawn the same way `tests/compatibility/harness-smoke.test.ts` does, with `--patch` pointing at `desktop-tools.patch.yml`. After creating a session with `cwd` set to a fixture repo that has `package.json` `{ "name": "smoke-demo" }`, send a trivial prompt and assert history contains `smoke-demo` inside a `system-reminder`.

If spawning real dsh in this environment is blocked, record the manual checklist below and do not claim live injection works.

Manual checklist:

1. Restart Desktop so the installer re-links the plugin and skills.
2. Open a repo that has `package.json`.
3. New session, ask “这个项目叫什么”.
4. First request must mention the package name without the model having to `read` it.
5. `/skills` or skill catalog lists `project-onboarding`, `verify-before-complete`, `small-safe-edits`.
6. Phone settings page still present. `/phn` still loads.

---

## Review log (merged into the body above)

| ID | Sev | Finding | Resolution in this plan |
|---|---|---|---|
| R1 | 🔴 | `agent.inject()` can miss the first claimed batch | Fold after `await next()` on `agent/pre-step` |
| R2 | 🔴 | dsh child cannot import workspace TS | Bundle `process-bridge.ts` into plugin `lib/process-bridge.js` |
| R3 | 🟡 | Burning `sessionId` on a failed snapshot blocks retry | Add to `alreadyInjected` only after success |
| R4 | 🟡 | FS hang blocks the model step | 2000ms timeout, then skip |
| R5 | 🟡 | Listener throw aborts the turn | try/catch, return downstream decision |
| R6 | 🟡 | Wrong cwd leaf | Fail-safe skip; confirm in smoke |
| R7 | 🟡 | Skills in repo are invisible to official scanner | Symlink into `$DSH_HOME/skills` |
| R8 | 🟡 | Existing user skill dir | Do not overwrite a real directory |
| R9 | 🟢 | Resume after process restart re-injects once | Accepted; matches official instruction reload |
| R10 | 🟢 | Live verifier / task engine / ChatView | Explicitly out of this plan |
| R11 | 🟢 | Message order | Append after claimed user messages, same as `dsh-agent-instructions` |
| R12 | 🟡 | `createUserMessage` is a Harness import | Allowed only in plugin JS, not in domain/adapter TS |
| R13 | 🟢 | Phone plugins | Untouched |
| R14 | 🟡 | Bundled JS can drift | Sandbox test asserts the bundle contains `prepareProjectContextMessage` and no `@deepseek-ai/` |

## Acceptance

- `pnpm --filter @dshd/coding-agent test`
- `pnpm --filter @dshd/harness-adapter test`
- `pnpm --filter @dshd/desktop exec vitest run electron/runtime/coding-agent-installer.test.ts electron/runtime/coding-agent-skills.test.ts`
- `node --test apps/desktop/plugins/plugin-sandbox.test.mjs`
- No `@deepseek-ai/*` files in the git diff
- After Desktop restart: first turn sees package name; three skills visible; phone page intact

## Follow-on (not this plan)

1. Live TaskEngine transitions + Verifier via sandbox bash + `steer` on failure (cap 2).
2. Persist `.dsh/tasks/<sessionId>.json`.
3. Desktop status bar consuming `task-updated` / `verify-finished`.
4. `afterEdit` hook on `write`/`edit` `tools/result`.
