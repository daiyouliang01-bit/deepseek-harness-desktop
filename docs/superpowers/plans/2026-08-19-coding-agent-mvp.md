# Coding Agent MVP Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking. TDD is required. Do not modify any `@deepseek-ai/*` package.

**Status:** Phase-1 domain + insert-only host plugin + protocol events implemented and tested (2026-08-19). Host `apply()` is still a no-op; live `agent/pre-step` injection is a later slice.

**Goal:** Add a Claude Code-like coding layer on DeepSeek Harness Desktop without forking the official runtime: project snapshot, thin task lifecycle, verifier, small memory, official-format skills, and empty hooks.

**Architecture:** Official DSH stays the runtime. New domain logic lives in `@dshd/coding-agent` (no Harness imports). The only Harness-facing code is `@dshd/harness-adapter` plus a host Cordis plugin that **inserts a new row id**. Desktop UI keeps consuming `@dshd/protocol`. Phone plugins are untouched.

**Tech Stack:** TypeScript workspace packages, Vitest, existing Electron plugin-link pattern, official DSH skills (`SKILL.md`).

**Spec:** Session architecture analysis v1.2 (Harness → Adapter → Coding Agent → Desktop UI).

## Global Constraints

- Do not modify `@deepseek-ai/*` source or shipped presets (`standard` / `code` / `cordis` / `minimal`).
- Do not invent a second Skills runtime or a second event bus.
- Do not expand official-row patches in `desktop-tools.patch.yml` (permission / sandbox stay as they are). New work may only **append a new row id**.
- `@dshd/coding-agent` must never import `@deepseek-ai/*`.
- Process adapter may listen only to official events (`agent/pre-step`, `tools/pre-execute`, `tools/post-execute`, `tools/result`) and may only `steer`/`inject`.
- Verifier runs through existing sandbox bash later; Task 1 does not execute commands.
- Phone-sync / phone-settings / pin-gate stay unmodified.
- Implementation root is `DeepSeekHarnessDesktop`, not `DPH`.

## File map

- Create: `packages/coding-agent/**` — pure domain
- Create: `packages/harness-adapter/**` — event mapping only
- Create: `apps/desktop/plugins/dsh-coding-agent/**` — host plugin, new id `coding-agent`
- Create: `apps/desktop/electron/runtime/coding-agent-installer.ts` — symlink like phone-settings
- Create: `apps/desktop/skills/**` — official-format SKILL.md (Task 7)
- Modify: `apps/desktop/resources/desktop-tools.patch.yml` — **append** one new row
- Modify: `apps/desktop/electron/main/index.ts` — call the new installer before spawn
- Modify: `apps/desktop/plugins/plugin-sandbox.test.mjs` — assert the new host plugin
- Do not modify: official Harness packages, phone plugins, permission block

---

### Task 1: Scaffold packages and insert-only host plugin

**Files:**
- Create: `packages/coding-agent/package.json`
- Create: `packages/coding-agent/tsconfig.json`
- Create: `packages/coding-agent/vitest.config.ts`
- Create: `packages/coding-agent/src/index.ts`
- Create: `packages/coding-agent/src/create-coding-agent.test.ts`
- Create: `packages/harness-adapter/package.json`
- Create: `packages/harness-adapter/tsconfig.json`
- Create: `packages/harness-adapter/vitest.config.ts`
- Create: `packages/harness-adapter/src/index.ts`
- Create: `packages/harness-adapter/src/map-events.test.ts`
- Create: `apps/desktop/plugins/dsh-coding-agent/package.json`
- Create: `apps/desktop/plugins/dsh-coding-agent/cordis.patch.yml`
- Create: `apps/desktop/plugins/dsh-coding-agent/lib/index.js`
- Create: `apps/desktop/electron/runtime/coding-agent-installer.ts`
- Create: `apps/desktop/electron/runtime/coding-agent-installer.test.ts`
- Create: `apps/desktop/electron/runtime/coding-agent-patch.test.ts`
- Modify: `apps/desktop/resources/desktop-tools.patch.yml` (append only)
- Modify: `apps/desktop/electron/main/index.ts` (installer call)
- Modify: `apps/desktop/plugins/plugin-sandbox.test.mjs`

**Interfaces:**
- Consumes: existing plugin-link pattern (`ensurePhoneSettingsLinked`)
- Produces:
  - `createCodingAgent(): CodingAgent`
  - `CODING_AGENT_ID = 'coding-agent'`
  - `PROCESS_PLUGIN_ID = 'coding-agent'`
  - `mapCodingAgentToDesktopEvents(agent: CodingAgent): DesktopCodingEvent[]`
  - `ensureCodingAgentLinked(dshHome: string, appRoot: string): string | null`

- [x] **Step 1: Write the failing domain test**

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CODING_AGENT_ID, createCodingAgent } from './index'

describe('createCodingAgent', () => {
  it('returns idle stubs for every first-phase module', () => {
    const agent = createCodingAgent()
    expect(agent.id).toBe('coding-agent')
    expect(agent.version).toBe('0.1.0')
    expect(agent.taskEngine.phase()).toBe('idle')
    expect(agent.verifier.lastResult()).toBeNull()
    expect(agent.memory.read()).toBe('')
    expect(agent.hooks.run('afterEdit', {})).toBeUndefined()
  })

  it('does not import official Harness packages', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')
    expect(src).not.toMatch(/@deepseek-ai\//)
  })
})
```

- [x] **Step 2: Run it and confirm it fails because the module is missing**

Run: `pnpm --filter @dshd/coding-agent test`
Expected: FAIL / package not found, or `Cannot find module './index'`

- [x] **Step 3: Write the minimal domain implementation**

`createCodingAgent()` returns idle stubs. No Harness types.

- [x] **Step 4: Write failing adapter + installer + patch tests, then minimal implementation**

Installer copies `phone-settings-installer` with leaf `coding-agent-host`.
Patch test asserts `desktop-tools.patch.yml` contains `id: coding-agent` and does **not** change `defaultPreset: desktop-auto`.
Plugin `apply()` is a no-op and publishes no service.

- [x] **Step 5: Run package tests + desktop installer/patch tests + plugin-sandbox**

Run:
- `pnpm --filter @dshd/coding-agent test`
- `pnpm --filter @dshd/harness-adapter test`
- `pnpm --filter @dshd/desktop test -- electron/runtime/coding-agent-installer.test.ts electron/runtime/coding-agent-patch.test.ts`
- `node --test apps/desktop/plugins/plugin-sandbox.test.mjs`

Expected: PASS

---

### Task 2: Project Context snapshot

**Files:**
- Create: `packages/coding-agent/src/project-context.ts`
- Create: `packages/coding-agent/src/project-context.test.ts`
- Modify: `packages/coding-agent/src/index.ts` — `projectContext.snapshot` calls the real function

**Interfaces:**
- Consumes: `createCodingAgent()`
- Produces:
  - `type ProjectSnapshot = { root: string; manifestName?: string; scripts: string[]; tree: string[]; omitted: number; bytes: number }`
  - `snapshotProject(root: string, io: { readText(path: string): Promise<string | null>; listDir(path: string): Promise<string[]> }): Promise<ProjectSnapshot>`
  - `renderProjectSnapshot(snapshot: ProjectSnapshot): string` — wrapped in `<system-reminder>`, max 12_000 bytes

Behavior:
- Detect files: `README.md`, `README*`, `package.json`, `pnpm-workspace.yaml`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Makefile`
- Do not re-inject `AGENTS.md` body
- Tree depth 2, skip `node_modules`, `.git`, `dist`, `build`
- Empty repo returns a snapshot with empty lists, never throws

---

### Task 3: Task engine state machine

**Files:**
- Create: `packages/coding-agent/src/task-engine.ts`
- Create: `packages/coding-agent/src/task-engine.test.ts`

**Interfaces:**
- Produces:
  - `type TaskPhase = 'idle' | 'planning' | 'working' | 'verifying' | 'completed' | 'failed'`
  - `class TaskEngine { phase(): TaskPhase; transition(next: TaskPhase): void; persist(path: string, write: (p: string, data: string) => void): void; restore(path: string, read: (p: string) => string | null): void }`

Legal edges: `idle→planning|working`, `planning→working`, `working→verifying`, `verifying→working|completed|failed`, `completed|failed→idle`. Anything else throws `IllegalTaskTransition`.
Persist as JSON `{ version: 1, phase, updatedAt }` via temp file + rename.

---

### Task 4: Verifier probe + cap

**Files:**
- Create: `packages/coding-agent/src/verifier.ts`
- Create: `packages/coding-agent/src/verifier.test.ts`

**Interfaces:**
- Produces:
  - `type VerifyKind = 'test' | 'lint' | 'typecheck' | 'build'`
  - `type VerifyResult = { kind: VerifyKind; command: string; ok: boolean; output: string }`
  - `detectVerifyCommands(manifest: { scripts?: Record<string, string> }): VerifyKind[]`
  - `class Verifier { constructor(run: (cmd: string) => Promise<{ ok: boolean; output: string }>); runAll(cmds: Partial<Record<VerifyKind, string>>): Promise<VerifyResult[]>; autoFixAttempts: number }`

No script → skip that kind. Output truncated to 8_000 chars. `autoFixAttempts` max 2. Unknown manifest → empty command list (漏做不误跑).

---

### Task 5: Project memory file

**Files:**
- Create: `packages/coding-agent/src/memory.ts`
- Create: `packages/coding-agent/src/memory.test.ts`

**Interfaces:**
- Produces:
  - `readMemory(text: string): string` — trim, cap 8_192 bytes
  - `appendMemory(existing: string, entry: string): { ok: true; next: string } | { ok: false; reason: 'secret' | 'empty' | 'cap' }`

Reject lines matching `api[_-]?key|secret|token|password` (case-insensitive).

---

### Task 6: Hooks registry

**Files:**
- Create: `packages/coding-agent/src/hooks.ts`
- Create: `packages/coding-agent/src/hooks.test.ts`

**Interfaces:**
- Produces:
  - `type HookName = 'beforeTool' | 'afterTool' | 'afterEdit' | 'beforeTask' | 'afterTask'`
  - `class HookRegistry { on(name: HookName, fn: (payload: unknown) => void): () => void; run(name: HookName, payload: unknown): void }`

`run` catches listener errors and records them; it never throws.

---

### Task 7: Official-format skills

**Files:**
- Create: `apps/desktop/skills/project-onboarding/SKILL.md`
- Create: `apps/desktop/skills/verify-before-complete/SKILL.md`
- Create: `apps/desktop/skills/small-safe-edits/SKILL.md`
- Create: `apps/desktop/electron/runtime/coding-agent-skills.test.ts`

Skills use official frontmatter (`name`, `description`) only. Test asserts kebab-case names and that files parse as `SKILL.md` bundles. Do not add a skill loader.

---

### Task 8: Desktop protocol events + installer already wired

**Files:**
- Modify: `packages/protocol/src/events.ts` — add `task-updated` / `verify-finished` as tolerated event types
- Modify: `packages/harness-adapter/src/index.ts` — map engine/verifier to those events
- Modify: `packages/protocol/src/events` tests

No custom ChatView rewrite. No phone UI changes.

---

## Why existing Desktop files must change

| File | Why |
|---|---|
| `desktop-tools.patch.yml` | Desktop-owned `--patch` overlay. Official extension point. Append `coding-agent` only. |
| `electron/main/index.ts` | Same as phone-settings: link plugin into `~/.dsh/profiles/web/node_modules` before spawn. |
| `plugin-sandbox.test.mjs` | Existing contract test for which host plugins main wires. |

No official Harness file is modified.
