# Coding Agent Live Verify Implementation Plan

> **For agentic workers:** Inline TDD. Do not modify `@deepseek-ai/*`. Checkbox steps.

**Status:** v1.2 implemented. SessionLoop, host listeners, persist+lastVerify, ChatView poll of `.dsh/tasks/<id>.json`, and isolated real-node verify smoke all tested. Official mux still does not carry `task-updated`; the custom shell reads the sidecar file.

**Goal:** After a session edits files, run the project's existing verify scripts, auto-steer at most two fixes, persist a simple task phase, and show phase/verify on the Desktop custom shell.

**Architecture:** Keep domain classes (`TaskEngine`, `Verifier`) unchanged. Add a pure `SessionLoop` in `@dshd/harness-adapter` that decides transitions and verify/steer. The host plugin only maps official `tools/result` + `turn/end` onto that loop and runs commands through `ctx.tools.execute('bash')` when present. Desktop reads `task-updated` / `verify-finished` already in `@dshd/protocol`.

**Tech Stack:** existing Vitest packages, host plugin JS, bundled `process-bridge.js`, official bash tool.

**Spec:** architecture v1.2 + `docs/superpowers/plans/2026-08-19-coding-agent-live-context.md`.

## Global Constraints

- Do not modify `@deepseek-ai/*` or shipped presets.
- `@dshd/coding-agent` and `SessionLoop` must not import `@deepseek-ai/*`.
- Do not spawn a raw shell. Plugin `runCommand` uses `ctx.tools.execute` for `bash`; if that API is missing, skip verify (漏做).
- Unknown / missing scripts → skip that kind. Zero kinds → do not enter `verifying`.
- Auto-fix cap is 2 (`Verifier.tryAutoFix`).
- Command timeout 60_000ms. Output already capped at 8_000 chars.
- Phone plugins untouched. No ChatView rewrite — only a one-line status strip.
- Re-bundle `process-bridge.js` after adapter TS changes.

## File map

- Create: `packages/harness-adapter/src/session-loop.ts`
- Create: `packages/harness-adapter/src/session-loop.test.ts`
- Modify: `packages/harness-adapter/src/index.ts` — re-export
- Modify: `packages/coding-agent/src/verifier.ts` — add `resolveNpmVerifyCommands`
- Modify: `apps/desktop/plugins/dsh-coding-agent/lib/index.js` — listen `tools/result` + `turn/end`
- Modify: `apps/desktop/src/renderer/src/features/chat/ChatView.tsx` — status strip
- Modify: `apps/desktop/src/renderer/src/features/chat/event-reducer.ts` — keep last task/verify
- Test: `tests/compatibility/coding-agent-verify.test.ts` (isolated, skip if no dsh)

---

### Task 1: resolveNpmVerifyCommands + SessionLoop

**Files:**
- Modify: `packages/coding-agent/src/verifier.ts`
- Modify: `packages/coding-agent/src/verifier.test.ts`
- Create: `packages/harness-adapter/src/session-loop.ts`
- Create: `packages/harness-adapter/src/session-loop.test.ts`

**Interfaces:**

```ts
export function resolveNpmVerifyCommands(
  scripts: Record<string, string> | undefined,
): Partial<Record<VerifyKind, string>>
// example: { test: 'npm run test', lint: 'npm run lint' }

export type LoopPorts = {
  readText(path: string): Promise<string | null>
  writeFile(path: string, data: string): void
  runCommand(cmd: string): Promise<{ ok: boolean; output: string }>
  mkdirp(path: string): void
}

export type LoopAction =
  | { type: 'none' }
  | { type: 'steer'; content: string }
  | { type: 'status'; phase: TaskPhase; lastVerify: Array<{ kind: string; ok: boolean }> | null }

export class SessionLoop {
  noteUserTurn(sessionId: string): LoopAction
  noteMutation(sessionId: string, toolName: string): LoopAction
  finishTurn(sessionId: string, cwd: string | undefined, ports: LoopPorts): Promise<LoopAction>
  view(sessionId: string): { phase: TaskPhase; lastVerify: Array<{ kind: string; ok: boolean }> | null }
}
```

Rules:
- `noteUserTurn`: `idle → working`.
- `noteMutation`: if tool name is `write`, `edit`, or `str_replace_editor`, mark dirty. Ignore other tools.
- `finishTurn`: if not dirty or no cwd or no verify scripts → `{ type: 'none' }`. Else `working → verifying`, run commands, persist `.dsh/tasks/<sessionId>.json`. All ok → `completed`. Else `tryAutoFix()` true → `working` + steer with failure output; false → `failed`.
- Illegal transitions are swallowed; return `{ type: 'none' }`.
- Persist failures do not throw.

- [ ] **Step 1: failing tests** for `resolveNpmVerifyCommands` and `SessionLoop` (see implementation below).
- [ ] **Step 2: run** `pnpm --filter @dshd/coding-agent test` and `pnpm --filter @dshd/harness-adapter test` — expect missing symbol / module.
- [ ] **Step 3: minimal implementation**.
- [ ] **Step 4: re-run both packages — PASS**.

---

### Task 2: Host plugin wires official events

Listen:
- `tools/result` — if `exec.name` in mutation set, `noteMutation`.
- `turn/end` — `finishTurn`; if action is `steer`, `agent.steer(createUserMessage(...))`.

Never throw. Re-bundle process-bridge after exporting SessionLoop from the same bundle entry **or** add `session-loop.ts` to the existing esbuild entry by changing the bundle entry to a new `packages/harness-adapter/src/plugin-api.ts` that re-exports both `prepareProjectContextMessage` and `SessionLoop`.

Keep `process-bridge.js` filename so `index.js` import stays stable: export SessionLoop from process-bridge.ts **or** change index.js to import `./session-loop.js` after adding a second outfile. Simplest: export `SessionLoop` from `process-bridge.ts` (same bundle).

- [ ] **Step 1:** sandbox test asserts `apply` registers `tools/result` and `turn/end`.
- [ ] **Step 2:** run sandbox — FAIL.
- [ ] **Step 3:** implement listeners + rebundle.
- [ ] **Step 4:** sandbox PASS.

---

### Task 3: Desktop one-line status

In `event-reducer.ts`, on `task-updated` / `verify-finished`, store `{ phase, verifyOk }`.
In `ChatView.tsx`, render a muted one-line strip: `task: working` / `verify: failed`.

- [ ] Reducer tests first, then UI.

---

### Task 4: Isolated smoke (optional if dsh available)

Fixture repo with `"scripts": { "test": "node -e \"process.exit(1)\"" }`. After a write tool result + turn/end, expect a steer or failed phase. Skip when `dsh` missing.

---

## Review merged in

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| R1 | 🔴 | Raw spawn bypasses sandbox | `runCommand` port; plugin uses `ctx.tools.execute('bash')` or skip |
| R2 | 🔴 | Verify on every turn | Only after write/edit/str_replace_editor |
| R3 | 🟡 | No scripts → fake fail | Do not enter verifying |
| R4 | 🟡 | Illegal transition kills loop | Catch, return none |
| R5 | 🟡 | Persist crash | try/catch; corrupt restore already idle |
| R6 | 🟡 | Hang | 60s timeout on runCommand |
| R7 | 🟢 | Status UI rewrite | One muted line only |
| R8 | 🟡 | Bundle drift | Re-run bundle script; sandbox asserts export names |
| R9 | 🟡 | Two sessions one repo | Engine keyed by sessionId |
| R10 | 🟢 | Planning phase | Skip; idle→working on first user turn |
| R11 | 🟡 | npm vs pnpm | `npm run <script>` only; fail-safe if it fails |
| R12 | 🟢 | Phone | Untouched |
