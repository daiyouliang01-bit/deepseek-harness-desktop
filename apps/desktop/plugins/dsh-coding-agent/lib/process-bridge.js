// ../../packages/harness-adapter/src/process-bridge.ts
import { join as join2 } from "node:path";

// ../../packages/coding-agent/src/project-context.ts
var PROJECT_SNAPSHOT_MAX_BYTES = 12e3;
var SKIP = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build"]);
function joinPath(root, name) {
  return root.endsWith("/") ? `${root}${name}` : `${root}/${name}`;
}
async function safeList(io, path) {
  try {
    return await io.listDir(path);
  } catch {
    return [];
  }
}
async function snapshotProject(root, io) {
  const scripts = [];
  let manifestName;
  const pkgText = await io.readText(joinPath(root, "package.json"));
  if (pkgText) {
    try {
      const parsed = JSON.parse(pkgText);
      if (typeof parsed.name === "string") manifestName = parsed.name;
      if (parsed.scripts && typeof parsed.scripts === "object") {
        scripts.push(...Object.keys(parsed.scripts));
      }
    } catch {
    }
  }
  const tree = [];
  let omitted = 0;
  const top = await safeList(io, root);
  for (const name of top.sort()) {
    if (SKIP.has(name)) {
      omitted += 1;
      continue;
    }
    tree.push(name);
    const children = await safeList(io, joinPath(root, name));
    for (const child of children.sort()) {
      if (SKIP.has(child)) {
        omitted += 1;
        continue;
      }
      tree.push(`${name}/${child}`);
    }
  }
  return { root, manifestName, scripts, tree, omitted, bytes: 0 };
}
function truncateUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = low + high + 1 >> 1;
    if (Buffer.byteLength(text.slice(0, mid), "utf8") <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low);
}
function renderProjectSnapshot(snapshot) {
  const lines = [
    "<system-reminder>",
    "Project context snapshot. Use it as guidance. It does not override user instructions.",
    `Root: ${snapshot.root}`
  ];
  if (snapshot.manifestName) lines.push(`Package: ${snapshot.manifestName}`);
  if (snapshot.scripts.length > 0) lines.push(`Scripts: ${snapshot.scripts.join(", ")}`);
  if (snapshot.tree.length > 0) {
    lines.push("Tree:");
    for (const entry of snapshot.tree) lines.push(`- ${entry}`);
  }
  if (snapshot.omitted > 0) lines.push(`omitted: ${snapshot.omitted}`);
  lines.push("</system-reminder>");
  const text = lines.join("\n");
  snapshot.bytes = Buffer.byteLength(text, "utf8");
  if (snapshot.bytes <= PROJECT_SNAPSHOT_MAX_BYTES) return text;
  const budget = PROJECT_SNAPSHOT_MAX_BYTES - Buffer.byteLength("\n\u2026 omitted\n</system-reminder>", "utf8");
  return `${truncateUtf8(text, budget)}
\u2026 omitted
</system-reminder>`;
}

// ../../packages/coding-agent/src/task-engine.ts
import { renameSync } from "node:fs";
var LEGAL = {
  idle: ["planning", "working"],
  planning: ["working"],
  working: ["verifying"],
  verifying: ["working", "completed", "failed"],
  completed: ["idle"],
  failed: ["idle"]
};
var IllegalTaskTransition = class extends Error {
  from;
  to;
  constructor(from, to) {
    super(`Illegal task transition: ${from} \u2192 ${to}`);
    this.name = "IllegalTaskTransition";
    this.from = from;
    this.to = to;
  }
};
var TaskEngine = class {
  #phase = "idle";
  phase() {
    return this.#phase;
  }
  transition(next) {
    if (!LEGAL[this.#phase].includes(next)) {
      throw new IllegalTaskTransition(this.#phase, next);
    }
    this.#phase = next;
  }
  persist(path, write) {
    const payload = JSON.stringify({
      version: 1,
      phase: this.#phase,
      updatedAt: Date.now()
    });
    const tmp = `${path}.tmp`;
    write(tmp, payload);
    renameSync(tmp, path);
  }
  restore(path, read) {
    const raw = read(path);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1) return;
      if (typeof parsed.phase !== "string" || !(parsed.phase in LEGAL)) return;
      this.#phase = parsed.phase;
    } catch {
    }
  }
};

// ../../packages/coding-agent/src/verifier.ts
var KIND_ALIASES = {
  test: "test",
  lint: "lint",
  typecheck: "typecheck",
  "type-check": "typecheck",
  build: "build"
};
var KIND_ORDER = ["test", "lint", "typecheck", "build"];
var OUTPUT_CAP = 8e3;
var AUTO_FIX_CAP = 2;
function resolveVerifyCommands(scripts, lockfile = "npm") {
  if (!scripts) return {};
  const runner = lockfile === "pnpm" ? "pnpm run" : lockfile === "yarn" ? "yarn run" : "npm run";
  const cmds = {};
  for (const [name, kind] of Object.entries(KIND_ALIASES)) {
    if (scripts[name] && !cmds[kind]) cmds[kind] = `${runner} ${name}`;
  }
  return cmds;
}
function detectLockfile(files) {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  return "npm";
}
var Verifier = class {
  autoFixAttempts = 0;
  #lastResult = null;
  #run;
  constructor(run) {
    this.#run = run;
  }
  lastResult() {
    return this.#lastResult;
  }
  tryAutoFix() {
    if (this.autoFixAttempts >= AUTO_FIX_CAP) return false;
    this.autoFixAttempts += 1;
    return true;
  }
  async runAll(cmds) {
    const results = [];
    for (const kind of KIND_ORDER) {
      const command = cmds[kind];
      if (!command) continue;
      const raw = await this.#run(command);
      results.push({
        kind,
        command,
        ok: raw.ok,
        output: raw.output.slice(0, OUTPUT_CAP)
      });
    }
    this.#lastResult = results;
    return results;
  }
};

// ../../packages/coding-agent/src/memory.ts
var MEMORY_MAX_BYTES = 8192;
function readMemory(text) {
  const trimmed = text.trim();
  if (Buffer.byteLength(trimmed, "utf8") <= MEMORY_MAX_BYTES) return trimmed;
  let cut = trimmed;
  while (Buffer.byteLength(cut, "utf8") > MEMORY_MAX_BYTES) {
    cut = cut.slice(0, Math.max(0, cut.length - 16));
  }
  return cut;
}

// ../../packages/harness-adapter/src/session-loop.ts
import { join } from "node:path";
var MUTATIONS = /* @__PURE__ */ new Set(["write", "edit", "str_replace_editor"]);
function interpretCommandResult(raw) {
  const output = typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content ?? raw);
  if (raw.isError) return { ok: false, output };
  const match = output.match(/\[exit code:\s*(\d+)\]/);
  if (match && match[1] !== "0") return { ok: false, output };
  return { ok: true, output };
}
var SessionLoop = class {
  #sessions = /* @__PURE__ */ new Map();
  #inflight = /* @__PURE__ */ new Map();
  #state(sessionId) {
    let state = this.#sessions.get(sessionId);
    if (!state) {
      state = {
        engine: new TaskEngine(),
        verifier: new Verifier(async () => ({ ok: true, output: "" })),
        dirty: false,
        lastVerify: null
      };
      this.#sessions.set(sessionId, state);
    }
    return state;
  }
  /** Read-only view: never creates a session entry (view must not leak). */
  view(sessionId) {
    const state = this.#sessions.get(sessionId);
    if (!state) return { phase: "idle", lastVerify: null };
    return { phase: state.engine.phase(), lastVerify: state.lastVerify };
  }
  /** Drop per-session state when the session ends (prevents leaks). */
  dispose(sessionId) {
    this.#sessions.delete(sessionId);
    this.#inflight.delete(sessionId);
  }
  get sessionCount() {
    return this.#sessions.size;
  }
  /** Start a fresh task cycle on a new user turn (completed/failed resets).
   *  The verifier's auto-fix budget also resets: a new task must not inherit
   *  the previous task's exhausted attempts. */
  #startTask(state) {
    const phase = state.engine.phase();
    if (phase === "idle") {
      state.engine.transition("working");
      return;
    }
    if (phase === "completed" || phase === "failed") {
      state.engine.transition("idle");
      state.engine.transition("working");
      state.verifier = new Verifier(async () => ({ ok: true, output: "" }));
    }
  }
  noteUserTurn(sessionId) {
    const state = this.#state(sessionId);
    try {
      this.#startTask(state);
    } catch {
      return { type: "none" };
    }
    return { type: "status", phase: state.engine.phase(), lastVerify: state.lastVerify };
  }
  noteMutation(sessionId, toolName) {
    if (!MUTATIONS.has(toolName)) return { type: "none" };
    const state = this.#state(sessionId);
    try {
      this.#startTask(state);
    } catch {
    }
    state.dirty = true;
    return { type: "status", phase: state.engine.phase(), lastVerify: state.lastVerify };
  }
  async finishTurn(sessionId, cwd, ports) {
    const state = this.#state(sessionId);
    if (!state.dirty || !cwd) return { type: "none" };
    const inflight = this.#inflight.get(sessionId);
    if (inflight) return inflight;
    const run = this.#finishTurn(sessionId, cwd, state, ports);
    this.#inflight.set(sessionId, run);
    try {
      return await run;
    } finally {
      this.#inflight.delete(sessionId);
    }
  }
  async #finishTurn(sessionId, cwd, state, ports) {
    let pkgText;
    let scripts;
    try {
      const [pkg, pnpmLock, yarnLock] = await Promise.all([
        ports.readText(join(cwd, "package.json")),
        ports.readText(join(cwd, "pnpm-lock.yaml")),
        ports.readText(join(cwd, "yarn.lock"))
      ]);
      pkgText = pkg;
      if (pkgText) {
        try {
          scripts = JSON.parse(pkgText).scripts;
        } catch {
          return { type: "none" };
        }
      }
      const lockfile = detectLockfile([pnpmLock ? "pnpm-lock.yaml" : void 0, yarnLock ? "yarn.lock" : void 0]);
      const cmds = resolveVerifyCommands(scripts, lockfile);
      if (Object.keys(cmds).length === 0) {
        state.dirty = false;
        return { type: "none" };
      }
      try {
        if (state.engine.phase() === "working") state.engine.transition("verifying");
      } catch {
        return { type: "none" };
      }
      const verifier = new Verifier((cmd) => ports.runCommand(cmd));
      verifier.autoFixAttempts = state.verifier.autoFixAttempts;
      let results;
      try {
        results = await verifier.runAll(cmds);
      } catch {
        return { type: "none" };
      }
      state.verifier = verifier;
      state.lastVerify = results;
      state.dirty = false;
      const ok = results.every((item) => item.ok);
      try {
        if (ok) state.engine.transition("completed");
        else if (verifier.tryAutoFix()) state.engine.transition("working");
        else state.engine.transition("failed");
      } catch {
        return { type: "none" };
      }
      this.#persist(sessionId, cwd, state, ports);
      if (!ok && state.engine.phase() === "working") {
        return {
          type: "steer",
          content: [
            "\u9A8C\u8BC1\u5931\u8D25\uFF0C\u8BF7\u4FEE\u590D\u539F\u59CB\u5931\u8D25\u9879\u540E\u505C\u6B62\u3002",
            ...results.filter((item) => !item.ok).map((item) => `\u3010${item.kind}\u3011${item.command}
${item.output}`)
          ].join("\n\n")
        };
      }
      return { type: "status", phase: state.engine.phase(), lastVerify: state.lastVerify };
    } catch {
      return { type: "none" };
    }
  }
  #persist(sessionId, cwd, state, ports) {
    try {
      const dir = join(cwd, ".dsh", "tasks");
      ports.mkdirp(dir);
      const target = join(dir, `${sessionId}.json`);
      const payload = JSON.stringify({
        version: 1,
        phase: state.engine.phase(),
        updatedAt: Date.now(),
        lastVerify: state.lastVerify
      });
      if (ports.rename) {
        const tmp = `${target}.tmp`;
        ports.writeFile(tmp, payload);
        ports.rename(tmp, target);
      } else {
        ports.writeFile(target, payload);
      }
    } catch {
    }
  }
};

// ../../packages/harness-adapter/src/process-bridge.ts
function contextKey(sessionId, cwd) {
  return `${sessionId}::${cwd}`;
}
async function prepareProjectContextMessage(input, ports) {
  if (!input.cwd) return null;
  const key = contextKey(input.sessionId, input.cwd);
  if (input.alreadyInjected.has(key)) return null;
  try {
    const snapshot = await snapshotProject(input.cwd, ports);
    const rawMemory = await ports.readText(join2(input.cwd, ".dsh", "memory.md"));
    const memory = rawMemory ? readMemory(rawMemory) : "";
    const body = renderProjectSnapshot(snapshot);
    const content = memory ? `${body}

<system-reminder>
Project memory:
${memory}
</system-reminder>` : body;
    return { content, key };
  } catch {
    return null;
  }
}
export {
  SessionLoop,
  contextKey,
  interpretCommandResult,
  prepareProjectContextMessage
};
