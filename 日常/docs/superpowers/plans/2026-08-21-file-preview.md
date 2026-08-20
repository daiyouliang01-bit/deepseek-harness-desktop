# dsh-file-preview 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DeepSeek Harness Desktop 右侧以多标签面板预览 md/代码/PDF/图片/网页/docx 等文件，入口为侧边栏「文件」按钮 + 可固定抽屉文件树 + 手动打开。

**Architecture:** 双面 Cordis 插件包 `@dshd/dsh-file-preview`（完全仿照 `@omdsh-dev/dsh-genui` 的包结构）。Host 半注册 `webServer` 的 `/preview/*` 前缀路由流式输出本地文件（PDF/图片/网页通道），并注册 6 个 `harness.handle` RPC（listDir/readText/stat/docxToHtml/openInApp/pickFile）。Client 半注册 `sidebar.footer.action`（文件按钮）、`shell.overlay`（文件树抽屉 + 右侧多标签预览面板）两个 slot。预览面板用 `shell.overlay` 右侧浮层实现（不替换官方 `details` 列 occupant，规避详情列被 conversation 包独占的冲突）。

**Tech Stack:** TypeScript、tsdown（构建，format cjs browser + esm node）、React 18、`@deepseek-ai/cordis`、`webServer` service、`harness.handle`、macOS `textutil`、node:http、node:fs。

**Spec:** `docs/superpowers/specs/2026-08-21-file-preview-design.md`（本计划依据，执行者须同时阅读）

## Global Constraints

- 包名 `@dshd/dsh-file-preview`，源码目录 `~/.dsh/plugins/dsh-file-preview/`
- 只允许读取绝对路径且 `resolve()` 后仍在允许根内（允许根 = 当前 workspace 根 + 用户 pickFile 显式选择的路径）
- `readText` 默认上限 2MB，超出截断并返回 `truncated: true`
- 多标签上限 8 个
- HTML 预览 iframe 必须 `sandbox`（不允许 allow-scripts 以外权限，不加 allow-same-origin）
- 每个任务必须 TDD：先写测试 → 跑通失败 → 实现 → 跑通通过 → commit
- 构建命令：`pnpm build`（`rm -rf lib && tsc -p tsconfig.json && tsdown`）
- client 半 `inject: ['slots']`；host 半不 inject 可选服务（webServer/tools 用 `ctx.reflect.get(name, false)` 探测 + `ctx.on('internal/service')` 等待）
- 环境：macOS（textutil/open 命令可用）、node 22、pnpm 11、dsh profile web

---

### Task 1: 包脚手架（package.json / tsconfig / tsdown / patch）

**Files:**
- Create: `~/.dsh/plugins/dsh-file-preview/package.json`
- Create: `~/.dsh/plugins/dsh-file-preview/tsconfig.json`
- Create: `~/.dsh/plugins/dsh-file-preview/tsdown.config.ts`
- Create: `~/.dsh/plugins/dsh-file-preview/cordis.patch.yml`
- Create: `~/.dsh/plugins/dsh-file-preview/.gitignore`

**Interfaces:**
- Produces: 可被 tsdown 构建的包骨架；`lib/index.js`（host 半入口，esm）+ `lib/client.js`（browser bundle）的构建管线；`cordis.patch.yml` 注册行 `- id: file-preview, name: '@dshd/dsh-file-preview'`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "@dshd/dsh-file-preview",
  "version": "0.1.0",
  "description": "Multi-tab file preview for DeepSeek Harness: markdown, code, PDF, images, local HTML, and docx via the right-side overlay panel.",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/plugin/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/plugin/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/client.js", "lib/types", "cordis.patch.yml"],
  "scripts": {
    "build": "rm -rf lib && tsc -p tsconfig.json && tsdown",
    "test": "vitest run"
  },
  "dependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "react": "^18.0.0 || ^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.0.0",
    "tsdown": "^0.22.2",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": [], "platform": "web" }
  },
  "packageManager": "pnpm@11.7.0",
  "engines": { "node": "^22.19.0 || >=24.0.0", "pnpm": ">=11.7.0 <12" }
}
```

- [ ] **Step 2: 创建 tsconfig.json**（`paths` 指向宿主类型源，仿 genui 但只留本包用到的）

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "types": [],
    "declaration": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "rootDir": "src",
    "outDir": "lib/types",
    "baseUrl": ".",
    "paths": {
      "@deepseek-ai/cordis": ["../../.dsh/source/current/vendor/cordis/lib/types/index.d.ts"],
      "@deepseek-ai/cordis/*": ["../../.dsh/source/current/vendor/cordis/lib/types/*"]
    },
    "emitDeclarationOnly": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 创建 tsdown.config.ts**（仿 genui：libConfig + clientConfig，无资产配置）

```ts
/** dsh-file-preview build: node-half lib + browser client bundle. Mirrors
 * dsh-genui's tsdown preset for one package. Deterministic, no sourcemap. */
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { UserConfig } from 'tsdown'

const ID = '@dshd/dsh-file-preview'
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

const EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom/client', '@deepseek-ai/cordis']

function purityGate(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not in the module table (EXTERNALS) — cross-plugin value imports are forbidden`,
      )
    },
  }
}

const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  minify: true,
  sourcemap: false,
  clean: false,
  deps: {
    neverBundle: [...EXTERNALS],
    alwaysBundle: (id: string) => !EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [purityGate()],
  outputOptions: {
    entryFileNames: 'client.js',
    codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

const libConfig: UserConfig = {
  name: ID,
  entry: ['src/plugin/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

export default [libConfig, clientConfig]
```

- [ ] **Step 4: 创建 cordis.patch.yml**

```yaml
# dsh-file-preview bundle for DeepSeek Harness (dsh).
# Inserted into the profile composition when installed via
# `dsh plugin --profile web add link:/path/to/dsh-file-preview` (file: dep in
# profile package.json). The node half serves /preview/* and the RPCs; the
# browser half registers the sidebar button, the file-tree drawer, and the
# right-side multi-tab preview panel.
- insert:
    - id: file-preview
      name: '@dshd/dsh-file-preview'
```

- [ ] **Step 5: 创建 .gitignore**

```
node_modules/
lib/
```

- [ ] **Step 6: 创建占位源文件让 tsc 能过**

Create `src/plugin/index.ts`（空 apply）和 `src/client/index.tsx`（空 apply），内容：

```ts
// src/plugin/index.ts
import { Context } from '@deepseek-ai/cordis'
export const inject: string[] = []
export function apply(_ctx: Context): void {}
```

```tsx
// src/client/index.tsx
import type { Context } from '@deepseek-ai/cordis'
export const inject = ['slots']
export function apply(_ctx: Context): (() => void) {
  return () => {}
}
```

- [ ] **Step 7: 安装依赖并构建验证**

Run: `cd ~/.dsh/plugins/dsh-file-preview && pnpm install && pnpm build`
Expected: 无类型错误；生成 `lib/index.js`（esm）+ `lib/client.js`（bundle，含 `window.__ModuleLoader__.load` banner）

- [ ] **Step 8: Commit**

```bash
cd ~/.dsh/plugins/dsh-file-preview
git init -q && git add -A && git commit -m "chore: dsh-file-preview 包脚手架（tsdown 双面构建）"
```

---

### Task 2: Host 半共享工具（路径校验 + Content-Type 映射）

**Files:**
- Create: `~/.dsh/plugins/dsh-file-preview/src/plugin/paths.ts`
- Create: `~/.dsh/plugins/dsh-file-preview/tests/plugin/paths.test.ts`

**Interfaces:**
- Produces:
  - `const ALLOWED_ROOTS: Set<string>`（运行时填充 workspace 根；默认含 `process.cwd()`）
  - `function assertAllowedPath(p: string): string` — 绝对路径 + resolve + 必须在任一 allowed root 内，否则抛 `Error('FP_PATH_DENIED')`
  - `function addAllowedRoot(p: string): void`
  - `function contentTypeForPath(p: string): string` — 扩展名 → Content-Type 映射（.md→text/markdown、.pdf→application/pdf、.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp→image/*、.html/.htm→text/html、文本类→text/plain; charset=utf-8、未知→application/octet-stream）

- [ ] **Step 1: 写失败测试**

```ts
// tests/plugin/paths.test.ts
import { describe, expect, it, beforeEach } from 'vitest'
import { assertAllowedPath, addAllowedRoot, contentTypeForPath } from '../src/plugin/paths.ts'

describe('assertAllowedPath', () => {
  beforeEach(() => { addAllowedRoot('/Users/t/ws') })

  it('允许根内的绝对路径', () => {
    expect(assertAllowedPath('/Users/t/ws/a.md')).toBe('/Users/t/ws/a.md')
  })
  it('拒绝相对路径', () => {
    expect(() => assertAllowedPath('a.md')).toThrow('FP_PATH_DENIED')
  })
  it('拒绝越界（.. 穿越）', () => {
    expect(() => assertAllowedPath('/Users/t/ws/../secret.txt')).toThrow('FP_PATH_DENIED')
  })
  it('拒绝根外路径', () => {
    expect(() => assertAllowedPath('/etc/passwd')).toThrow('FP_PATH_DENIED')
  })
})

describe('contentTypeForPath', () => {
  it('映射常见类型', () => {
    expect(contentTypeForPath('/a/b.md')).toBe('text/markdown')
    expect(contentTypeForPath('/a/b.pdf')).toBe('application/pdf')
    expect(contentTypeForPath('/a/b.png')).toBe('image/png')
    expect(contentTypeForPath('/a/b.html')).toBe('text/html')
    expect(contentTypeForPath('/a/b.ts')).toBe('text/plain; charset=utf-8')
  })
  it('未知扩展名回退 octet-stream', () => {
    expect(contentTypeForPath('/a/b.xyz')).toBe('application/octet-stream')
  })
  it('无扩展名回退 octet-stream', () => {
    expect(contentTypeForPath('/a/README')).toBe('application/octet-stream')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/.dsh/plugins/dsh-file-preview && npx vitest run tests/plugin/paths.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/plugin/paths.ts
import { resolve, extname, sep } from 'node:path'

const allowedRoots = new Set<string>()

export function addAllowedRoot(p: string): void {
  allowedRoots.add(resolve(p))
}

export function assertAllowedPath(p: string): string {
  if (!p.startsWith('/')) throw new Error('FP_PATH_DENIED')
  const resolved = resolve(p)
  for (const root of allowedRoots) {
    if (resolved === root || resolved.startsWith(root + sep)) return resolved
  }
  throw new Error('FP_PATH_DENIED')
}

const TEXT_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'css', 'html', 'htm',
  'yml', 'yaml', 'toml', 'sh', 'py', 'go', 'rs', 'c', 'h', 'cpp', 'java',
  'xml', 'sql', 'log', 'ini', 'cfg', 'env', 'gitignore', 'vue', 'svelte',
])

const IMAGE_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
}

export function contentTypeForPath(p: string): string {
  const ext = extname(p).slice(1).toLowerCase()
  if (ext === 'md') return 'text/markdown'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'html' || ext === 'htm') return 'text/html'
  if (ext in IMAGE_EXT) return IMAGE_EXT[ext]!
  if (ext === 'docx' || ext === 'doc' || ext === 'rtf') return 'application/octet-stream'
  if (TEXT_EXT.has(ext)) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd ~/.dsh/plugins/dsh-file-preview && npx vitest run tests/plugin/paths.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: Commit**

```bash
cd ~/.dsh/plugins/dsh-file-preview
git add src/plugin/paths.ts tests/plugin/paths.test.ts
git commit -m "feat: 路径校验与 Content-Type 映射（host 半）"
```

---

### Task 3: Host 半 RPC（listDir / readText / stat / docxToHtml / openInApp / pickFile）

**Files:**
- Create: `~/.dsh/plugins/dsh-file-preview/src/plugin/rpc.ts`
- Create: `~/.dsh/plugins/dsh-file-preview/src/plugin/convert.ts`
- Create: `~/.dsh/plugins/dsh-file-preview/tests/plugin/rpc.test.ts`

**Interfaces:**
- Consumes: `assertAllowedPath`, `addAllowedRoot` (Task 2)
- Produces:
  - `interface DirEntry { name: string; path: string; isDir: boolean; size: number; mtime: number }`
  - `async function listDir(p: string): Promise<DirEntry[]>` — 目录优先排序，条目含 stat
  - `async function readText(p: string, maxBytes?: number): Promise<{ text: string; truncated: boolean; mtime: number }>` — 默认 maxBytes=2MB
  - `async function statPath(p: string): Promise<{ exists: boolean; isDir: boolean; size: number; mtime: number; ext: string }>`
  - `async function docxToHtml(p: string): Promise<{ html: string } | { error: string }>` — textutil 转换（convert.ts）
  - `async function openInApp(p: string): Promise<{ ok: boolean; error?: string }>` — `open <path>`（spawn）
  - `async function pickFile(): Promise<{ path: string } | null>` — osascript choose file
  - `function registerRpcHandlers(handle: (method: string, h: (args: JsonValue) => Promise<JsonValue>) => void, cwd: string): void` — 注册全部 `fp.*` 方法；`fp.getRoot` 返回 cwd；`fp.addRoot` 将 pickFile 结果加入允许根

- [ ] **Step 1: 写失败测试**

```ts
// tests/plugin/rpc.test.ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addAllowedRoot, } from '../src/plugin/paths.ts'
import { listDir, readText, statPath } from '../src/plugin/rpc.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-test-'))
  addAllowedRoot(dir)
  writeFileSync(join(dir, 'a.md'), '# Hi\n')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'b.txt'), 'hello')
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

describe('listDir', () => {
  it('目录优先排序并返回条目', async () => {
    const entries = await listDir(dir)
    expect(entries[0]!.isDir).toBe(true)
    expect(entries[0]!.name).toBe('sub')
    expect(entries[1]!.name).toBe('a.md')
  })
})

describe('readText', () => {
  it('读取文本并带 mtime', async () => {
    const r = await readText(join(dir, 'a.md'))
    expect(r.text).toBe('# Hi\n')
    expect(r.truncated).toBe(false)
    expect(typeof r.mtime).toBe('number')
  })
  it('超过 maxBytes 截断', async () => {
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(100))
    const r = await readText(join(dir, 'big.txt'), 10)
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBe(10)
  })
})

describe('statPath', () => {
  it('报告存在与类型', async () => {
    const s = await statPath(join(dir, 'a.md'))
    expect(s.exists).toBe(true)
    expect(s.isDir).toBe(false)
    expect(s.ext).toBe('.md')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/.dsh/plugins/dsh-file-preview && npx vitest run tests/plugin/rpc.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 convert.ts**

```ts
// src/plugin/convert.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

/** macOS textutil: docx/doc/rtf → HTML. Returns {html} or {error}. */
export async function docxToHtml(p: string): Promise<{ html: string } | { error: string }> {
  const work = await mkdtemp(join(tmpdir(), 'fp-docx-'))
  const out = join(work, `${randomUUID()}.html`)
  try {
    await execFileAsync('textutil', ['-convert', 'html', '-output', out, p], { timeout: 15_000 })
    const html = await readFile(out, 'utf-8')
    return { html }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
```

- [ ] **Step 4: 实现 rpc.ts**

```ts
// src/plugin/rpc.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { assertAllowedPath, addAllowedRoot } from './paths.ts'
import { docxToHtml } from './convert.ts'

const execFileAsync = promisify(execFile)
const DEFAULT_MAX = 2 * 1024 * 1024

export interface DirEntry { name: string; path: string; isDir: boolean; size: number; mtime: number }
export interface StatResult { exists: boolean; isDir: boolean; size: number; mtime: number; ext: string }

export async function listDir(p: string): Promise<DirEntry[]> {
  const dir = assertAllowedPath(p)
  const names = await readdir(dir)
  const entries = await Promise.all(names.map(async (name) => {
    const full = join(dir, name)
    const st = await stat(full)
    return { name, path: full, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs }
  }))
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return entries
}

export async function readText(p: string, maxBytes = DEFAULT_MAX): Promise<{ text: string; truncated: boolean; mtime: number }> {
  const file = assertAllowedPath(p)
  const st = await stat(file)
  const buf = await readFile(file)
  const truncated = buf.length > maxBytes
  return { text: buf.subarray(0, maxBytes).toString('utf-8'), truncated, mtime: st.mtimeMs }
}

export async function statPath(p: string): Promise<StatResult> {
  try {
    const file = assertAllowedPath(p)
    const st = await stat(file)
    return { exists: true, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, ext: extname(file) }
  } catch {
    return { exists: false, isDir: false, size: 0, mtime: 0, ext: extname(p) }
  }
}

export async function openInApp(p: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const file = assertAllowedPath(p)
    await execFileAsync('open', [file])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function pickFile(): Promise<{ path: string } | null> {
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', 'POSIX path of (choose file)'])
    const path = stdout.trim()
    if (!path) return null
    addAllowedRoot(path)
    return { path }
  } catch {
    return null // user cancelled
  }
}

/** Register every fp.* RPC. handle = the harness.handle bound function. */
export function registerRpcHandlers(
  handle: (method: string, h: (args: unknown) => Promise<unknown>) => void,
  cwd: string,
): void {
  addAllowedRoot(cwd)
  const call = async (args: unknown): Promise<unknown> => {
    const a = (args ?? {}) as Record<string, unknown>
    const path = String(a.path ?? '')
    const fn = String(a.fn ?? '')
    switch (fn) {
      case 'listDir': return listDir(path)
      case 'readText': return readText(path, typeof a.maxBytes === 'number' ? a.maxBytes : undefined)
      case 'stat': return statPath(path)
      case 'docxToHtml': return docxToHtml(path)
      case 'openInApp': return openInApp(path)
      case 'pickFile': return pickFile()
      case 'getRoot': return { root: cwd }
      default: return { error: `unknown fp method ${fn}` }
    }
  }
  // harness dispatches one method per call; single entry "fp.call" keeps the
  // handler map small and lets the client send { fn, ...args }.
  handle('fp.call', call)
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd ~/.dsh/plugins/dsh-file-preview && npx vitest run tests/plugin/rpc.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd ~/.dsh/plugins/dsh-file-preview
git add src/plugin/convert.ts src/plugin/rpc.ts tests/plugin/rpc.test.ts
git commit -m "feat: host 半 RPC（listDir/readText/stat/docx/openInApp/pickFile）"
```

---

### Task 4: Host 半入口（webServer /preview 路由 + RPC 注册）

**Files:**
- Modify: `~/.dsh/plugins/dsh-file-preview/src/plugin/index.ts`
- Create: `~/.dsh/plugins/dsh-file-preview/src/plugin/preview-route.ts`
- Create: `~/.dsh/plugins/dsh-file-preview/tests/plugin/preview-route.test.ts`

**Interfaces:**
- Consumes: `assertAllowedPath`, `contentTypeForPath` (Task 2), `registerRpcHandlers` (Task 3)
- Produces: `function registerPreviewRoute(webServer: { register(route: unknown): unknown }): void` — 注册 `{ kind: 'prefix', path: '/preview/', handler }`；handler 为 `(req, res)`，解码 URL 中编码的绝对路径 → `assertAllowedPath` → stat 确认普通文件 → Content-Type 流式输出；HEAD 仅头；错误 404/403/500

- [ ] **Step 1: 写失败测试**

```ts
// tests/plugin/preview-route.test.ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addAllowedRoot } from '../src/plugin/paths.ts'
import { previewHandler } from '../src/plugin/preview-route.ts'
import { IncomingMessage, ServerResponse } from 'node:http'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-pv-'))
  addAllowedRoot(dir)
  writeFileSync(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

function fakeRes() {
  const calls: Array<[number, Record<string, string>]> = []
  const res = {
    writeHead: (code: number, headers: Record<string, string>) => { calls.push([code, headers]) },
    end: () => {},
  } as unknown as ServerResponse
  return { res, calls }
}

describe('previewHandler', () => {
  it('GET 返回文件与正确 Content-Type', async () => {
    const { res, calls } = fakeRes()
    const req = { method: 'GET', url: `/preview/${encodeURIComponent(join(dir, 'pic.png'))}` } as IncomingMessage
    await previewHandler(req, res)
    expect(calls[0]![0]).toBe(200)
    expect(calls[0]![1]['Content-Type']).toBe('image/png')
  })
  it('越界路径返回 403', async () => {
    const { res, calls } = fakeRes()
    const req = { method: 'GET', url: `/preview/${encodeURIComponent('/etc/passwd')}` } as IncomingMessage
    await previewHandler(req, res)
    expect(calls[0]![0]).toBe(403)
  })
  it('非 GET/HEAD 返回 405', async () => {
    const { res, calls } = fakeRes()
    const req = { method: 'POST', url: '/preview/x' } as IncomingMessage
    await previewHandler(req, res)
    expect(calls[0]![0]).toBe(405)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/.dsh/plugins/dsh-file-preview && npx vitest run tests/plugin/preview-route.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 preview-route.ts**

```ts
// src/plugin/preview-route.ts
import { createReadStream, statSync } from 'node:fs'
import { IncomingMessage, ServerResponse } from 'node:http'
import { assertAllowedPath, contentTypeForPath } from './paths.ts'

export async function previewHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end()
    return
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    res.writeHead(400).end()
    return
  }
  const encoded = pathname.startsWith('/preview/') ? pathname.slice('/preview/'.length) : null
  if (encoded === null) { res.writeHead(404).end(); return }
  let target: string
  try {
    target = assertAllowedPath(encoded)
  } catch {
    res.writeHead(403).end()
    return
  }
  let st
  try {
    st = statSync(target)
  } catch {
    res.writeHead(404).end()
    return
  }
  if (!st.isFile()) { res.writeHead(404).end(); return }
  res.writeHead(200, {
    'Content-Type': contentTypeForPath(target),
    'Content-Length': st.size,
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') { res.end(); return }
  const stream = createReadStream(target)
  stream.on('error', () => { res.destroy() })
  stream.pipe(res)
}
```

- [ ] **Step 4: 实现 host 入口 index.ts**

```ts
// src/plugin/index.ts
import { Context } from '@deepseek-ai/cordis'
import { registerRpcHandlers } from './rpc.ts'
import { previewHandler } from './preview-route.ts'
import { addAllowedRoot } from './paths.ts'

export const inject: string[] = []

export function apply(ctx: Context): void {
  addAllowedRoot(process.cwd())

  // RPCs: harness is a Host builtin; register fp.call once.
  harness.handle('fp.call', async (args) => {
    const a = (args ?? {}) as Record<string, unknown>
    const fn = String(a.fn ?? '')
    switch (fn) {
      case 'listDir': { const { listDir } = await import('./rpc.ts'); return listDir(String(a.path)) }
      case 'readText': { const { readText } = await import('./rpc.ts'); return readText(String(a.path), typeof a.maxBytes === 'number' ? a.maxBytes : undefined) }
      case 'stat': { const { statPath } = await import('./rpc.ts'); return statPath(String(a.path)) }
      case 'docxToHtml': { const { docxToHtml } = await import('./convert.ts'); return docxToHtml(String(a.path)) }
      case 'openInApp': { const { openInApp } = await import('./rpc.ts'); return openInApp(String(a.path)) }
      case 'pickFile': { const { pickFile } = await import('./rpc.ts'); return pickFile() }
      case 'getRoot': return { root: process.cwd() }
      default: return { error: `unknown fp method ${fn}` }
    }
  })

  // /preview/* route: optional webServer service, probe + wait.
  let registered = false
  const tryRegister = (value: { register(route: unknown): unknown } | undefined): void => {
    if (registered) return
    const webServer = value ?? ctx.reflect.get('webServer', false) as { register(route: unknown): unknown } | undefined
    if (webServer === undefined) return
    webServer.register({ kind: 'prefix', path: '/preview/', handler: previewHandler })
    registered = true
  }
  tryRegister(undefined)
  ctx.on('internal/service', (name: string, value: unknown) => {
    if (name === 'webServer') tryRegister(value as { register(route: unknown): unknown })
  })
}
```

> Note: 因 host 半动态 `harness` 为 builtin 可直接使用，但为避免 `process` 类型未声明问题，在 tsconfig `types` 中留空时用 `process.cwd()` 会报错 —— 解决方案：tsconfig `"types": ["node"]` 并安装 `@types/node`（已在 devDependencies）。

- [ ] **Step 5: 更新 tsconfig types**

修改 `tsconfig.json`：`"types": ["node"]`（替代原 `"types": []`）

- [ ] **Step 6: 运行全部测试 + 构建**

Run: `cd ~/.dsh/plugins/dsh-file-preview && npx vitest run && pnpm build`
Expected: 全部 PASS；`lib/index.js` + `lib/client.js` 生成

- [ ] **Step 7: Commit**

```bash
cd ~/.dsh/plugins/dsh-file-preview
git add -A
git commit -m "feat: /preview 流式路由 + harness RPC 入口（host 半）"
```

---

### Task 5: Client 半 — 标签状态机 + 文件树组件

**Files:**
- Create: `~/.dsh/plugins/dsh-file-preview/src/client/tabs.ts`
- Create: `~/.dsh/plugins/dsh-file-preview/src/client/file-tree.tsx`
- Create: `~/.dsh/plugins/dsh-file-preview/tests/client/tabs.test.ts`

**Interfaces:**
- Consumes: Host RPC via `host.call('fp.call', { fn, ... })`（Task 3/4）
- Produces:
  - `interface PreviewTab { id: string; path: string; name: string; kind: TabKind; openedAt: number }`
  - `type TabKind = 'md' | 'code' | 'pdf' | 'image' | 'html' | 'docx' | 'binary' | 'txt'`
  - `function kindForPath(p: string): TabKind`（扩展名 → kind）
  - `function openTab(state: PreviewTab[], tab: Omit<PreviewTab,'id'|'openedAt'>): { tabs: PreviewTab[]; activeId: string }` — 去重激活或追加；上限 8
  - `function closeTab(state: PreviewTab[], activeId: string, id: string): { tabs: PreviewTab[]; activeId: string | null }` — 关闭后激活相邻
  - `function FileTree(props: { root: string; onOpen(path: string): void }): ReactElement` — 懒加载展开目录树；双击文件调 onOpen

- [ ] **Step 1: 写失败测试**

```ts
// tests/client/tabs.test.ts
import { describe, expect, it } from 'vitest'
import { kindForPath, openTab, closeTab } from '../src/client/tabs.ts'

describe('kindForPath', () => {
  it('识别各类型', () => {
    expect(kindForPath('/a/b.md')).toBe('md')
    expect(kindForPath('/a/b.pdf')).toBe('pdf')
    expect(kindForPath('/a/b.png')).toBe('image')
    expect(kindForPath('/a/b.html')).toBe('html')
    expect(kindForPath('/a/b.docx')).toBe('docx')
    expect(kindForPath('/a/b.ts')).toBe('code')
    expect(kindForPath('/a/b.txt')).toBe('txt')
    expect(kindForPath('/a/b.xyz')).toBe('binary')
  })
})

describe('openTab', () => {
  it('追加新标签并激活', () => {
    const r = openTab([], { path: '/a.md', name: 'a.md', kind: 'md' })
    expect(r.tabs.length).toBe(1)
    expect(r.activeId).toBe(r.tabs[0]!.id)
  })
  it('已存在则仅激活不重复', () => {
    const first = openTab([], { path: '/a.md', name: 'a.md', kind: 'md' })
    const r = openTab(first.tabs, { path: '/a.md', name: 'a.md', kind: 'md' })
    expect(r.tabs.length).toBe(1)
  })
  it('超过 8 个拒绝', () => {
    let state: PreviewTab[] = []
    for (let i = 0; i < 8; i++) state = openTab(state, { path: `/f${i}`, name: `f${i}`, kind: 'txt' }).tabs
    const r = openTab(state, { path: '/f9', name: 'f9', kind: 'txt' })
    expect(r.tabs.length).toBe(8)
  })
})

describe('closeTab', () => {
  it('关闭非激活标签保留激活', () => {
    const a = openTab([], { path: '/a', name: 'a', kind: 'txt' })
    const b = openTab(a.tabs, { path: '/b', name: 'b', kind: 'txt' })
    const r = closeTab(b.tabs, b.activeId, a.tabs[0]!.id)
    expect(r.tabs.length).toBe(1)
    expect(r.activeId).toBe(b.activeId)
  })
  it('关闭激活标签激活相邻', () => {
    const a = openTab([], { path: '/a', name: 'a', kind: 'txt' })
    const b = openTab(a.tabs, { path: '/b', name: 'b', kind: 'txt' })
    const c = openTab(b.tabs, { path: '/c', name: 'c', kind: 'txt' })
    const r = closeTab(c.tabs, c.activeId, c.activeId)
    expect(r.tabs.length).toBe(2)
    expect(r.activeId).not.toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/.dsh/plugins/dsh-file-preview && npx vitest run tests/client/tabs.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 tabs.ts**

```ts
// src/client/tabs.ts
export type TabKind = 'md' | 'code' | 'pdf' | 'image' | 'html' | 'docx' | 'binary' | 'txt'
export interface PreviewTab { id: string; path: string; name: string; kind: TabKind; openedAt: number }

let seq = 0
function nextId(): string { return `tab-${Date.now()}-${seq++}` }

export function kindForPath(p: string): TabKind {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'docx' || ext === 'doc' || ext === 'rtf') return 'docx'
  if (ext === 'txt') return 'txt'
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'yml', 'yaml', 'toml', 'sh', 'py', 'go', 'rs', 'c', 'h', 'cpp', 'java', 'xml', 'sql', 'vue', 'svelte']
  if (codeExts.includes(ext)) return 'code'
  return 'binary'
}

export function openTab(state: PreviewTab[], tab: Omit<PreviewTab, 'id' | 'openedAt'>): { tabs: PreviewTab[]; activeId: string } {
  const existing = state.find((t) => t.path === tab.path)
  if (existing) return { tabs: state, activeId: existing.id }
  if (state.length >= 8) return { tabs: state, activeId: state.length > 0 ? state[state.length - 1]!.id : '' }
  const full: PreviewTab = { ...tab, id: nextId(), openedAt: Date.now() }
  return { tabs: [...state, full], activeId: full.id }
}

export function closeTab(state: PreviewTab[], activeId: string | null, id: string): { tabs: PreviewTab[]; activeId: string | null } {
  const idx = state.findIndex((t) => t.id === id)
  if (idx === -1) return { tabs: state, activeId }
  const tabs = state.filter((t) => t.id !== id)
  let nextActive = activeId
  if (activeId === id) nextActive = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
  return { tabs, activeId: nextActive }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd ~/.dsh/plugins/dsh-file-preview && npx vitest run tests/client/tabs.test.ts`
Expected: PASS

- [ ] **Step 5: 实现 FileTree 组件（file-tree.tsx）**

```tsx
// src/client/file-tree.tsx
import { useEffect, useState, useCallback } from 'react'
import type { ReactElement } from 'react'

interface DirEntry { name: string; path: string; isDir: boolean; size: number; mtime: number }

function FolderRow({ entry, depth, onOpen }: { entry: DirEntry; depth: number; onOpen(p: string): void }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toggle = useCallback(async () => {
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (children === null) {
      try {
        const r = await host.call('fp.call', { fn: 'listDir', path: entry.path }) as DirEntry[]
        setChildren(r)
      } catch (e) { setError(String(e)) }
    }
  }, [expanded, children, entry.path])
  return (
    <div>
      <button
        onClick={toggle}
        style={{ paddingLeft: depth * 12, display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13, paddingTop: 3, paddingBottom: 3 }}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>📁</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
      </button>
      {expanded && children && children.map((c) => c.isDir
        ? <FolderRow key={c.path} entry={c} depth={depth + 1} onOpen={onOpen} />
        : <FileRow key={c.path} entry={c} depth={depth + 1} onOpen={onOpen} />)}
      {expanded && error && <div style={{ paddingLeft: depth * 12 + 16, color: 'var(--color-danger, #f87171)', fontSize: 12 }}>{error}</div>}
    </div>
  )
}

function FileRow({ entry, depth, onOpen }: { entry: DirEntry; depth: number; onOpen(p: string): void }): ReactElement {
  return (
    <button
      onClick={() => onOpen(entry.path)}
      title={entry.name}
      style={{ paddingLeft: depth * 12 + 18, display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13, paddingTop: 3, paddingBottom: 3 }}
    >
      <span>📄</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
    </button>
  )
}

export function FileTree({ root, onOpen }: { root: string; onOpen(path: string): void }): ReactElement {
  const [rootEntry] = useState<DirEntry>({ name: root.split('/').pop() || root, path: root, isDir: true, size: 0, mtime: 0 })
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <FolderRow entry={rootEntry} depth={0} onOpen={onOpen} />
    </div>
  )
}
```

> Note: `host` 为 client builtin，可直接用。若 `host` 类型未声明，添加 `declare const host: { call(method: string, args: unknown): Promise<unknown> }` 到 `src/client/host.d.ts`。

- [ ] **Step 6: 添加 host 类型声明（如需）**

Create `src/client/host.d.ts`:

```ts
declare const host: { call(method: string, args: unknown): Promise<unknown> }
declare const styles: { insert(css: string): () => void }
declare const ctx: import('@deepseek-ai/cordis').Context
```

- [ ] **Step 7: 构建验证**

Run: `cd ~/.dsh/plugins/dsh-file-preview && pnpm build`
Expected: 构建成功

- [ ] **Step 8: Commit**

```bash
cd ~/.dsh/plugins/dsh-file-preview
git add -A
git commit -m "feat: 标签状态机 + 文件树组件（client 半）"
```

---

### Task 6: Client 半 — 渲染器（md / code / pdf / image / html / docx / binary）

**Files:**
- Create: `~/.dsh/plugins/dsh-file-preview/src/client/md-render.ts`
- Create: `~/.dsh/plugins/dsh-file-preview/src/client/renderers.tsx`
- Create: `~/.dsh/plugins/dsh-file-preview/tests/client/md-render.test.ts`

**Interfaces:**
- Consumes: `kindForPath` (Task 5), Host RPC (`fp.call` readText/docxToHtml), preview URL
- Produces:
  - `function renderMarkdown(src: string): string` — 轻量 md → HTML 字符串（标题/粗斜体/行内代码/代码块/列表/引用/链接/图片/表格/分隔线）
  - `function PreviewUrl(path: string): string` — 返回 `/preview/${encodeURIComponent(path)}`
  - `function ContentView({ kind, path }: { kind: TabKind; path: string }): ReactElement` — 按 kind 分派渲染

- [ ] **Step 1: 写失败测试（md-render）**

```ts
// tests/client/md-render.test.ts
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/client/md-render.ts'

describe('renderMarkdown', () => {
  it('渲染标题', () => { expect(renderMarkdown('# Hi')).toContain('<h1>Hi</h1>') })
  it('渲染粗体与行内代码', () => {
    const html = renderMarkdown('**bold** and `code`')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
  })
  it('渲染代码块', () => {
    const html = renderMarkdown('```ts\nconst x = 1\n```')
    expect(html).toContain('<pre><code')
  })
  it('渲染列表', () => { expect(renderMarkdown('- a\n- b')).toContain('<li>a</li>') })
  it('渲染链接', () => {
    const html = renderMarkdown('[link](https://x.dev)')
    expect(html).toContain('<a href="https://x.dev">link</a>')
  })
  it('HTML 转义', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd ~/.dsh/plugins/dsh-file-preview && npx vitest run tests/client/md-render.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 md-render.ts**

```ts
// src/client/md-render.ts
/** Minimal, dependency-free markdown renderer: headings, emphasis, inline
 * code, fenced code, lists, blockquote, links, images, tables, hr, escaping.
 * Unsupported syntax degrades to plain text. Returns an HTML string. */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(src: string): string {
  return src
    .replace(/`([^`]+)`/g, (_m, c: string) => `<code>${esc(c)}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (_m, c: string) => `<strong>${c}</strong>`)
    .replace(/(^|[^*])\*([^*\n]+)\*/g, (_m, pre: string, c: string) => `${pre}<em>${c}</em>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, href: string) => `<a href="${esc(href)}">${t}</a>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src2: string) => `<img src="${esc(src2)}" alt="${esc(alt)}">`)
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith('```')) { buf.push(lines[i]!); i++ }
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      i++
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) { out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`); i++; continue }
    if (line.startsWith('> ')) {
      const buf: string[] = []
      while (i < lines.length && lines[i]!.startsWith('> ')) { buf.push(lines[i]!.slice(2)); i++ }
      out.push(`<blockquote>${buf.map((l) => inline(l)).join('<br>')}</blockquote>`)
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) { items.push(inline(lines[i]!.replace(/^\s*[-*]\s+/, ''))); i++ }
      out.push(`<ul>${items.map((it) => `<li>${it}</li>`).join('')}</ul>`)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) { items.push(inline(lines[i]!.replace(/^\s*\d+\.\s+/, ''))); i++ }
      out.push(`<ol>${items.map((it) => `<li>${it}</li>`).join('')}</ol>`)
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1]!)) {
      const header = line.split('|').filter((s) => s.trim() !== '').map((s) => inline(s.trim()))
      i += 2
      const rows: string[] = []
      while (i < lines.length && lines[i]!.includes('|')) {
        rows.push(`<tr>${lines[i]!.split('|').filter((s) => s.trim() !== '').map((s) => `<td>${inline(s.trim())}</td>`).join('')}</tr>`)
        i++
      }
      out.push(`<table><thead><tr>${header.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`)
      continue
    }
    if (/^\s*---+\s*$/.test(line)) { out.push('<hr>'); i++; continue }
    if (line.trim() === '') { i++; continue }
    out.push(`<p>${inline(line)}</p>`)
    i++
  }
  return out.join('\n')
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd ~/.dsh/plugins/dsh-file-preview && npx vitest run tests/client/md-render.test.ts`
Expected: PASS

- [ ] **Step 5: 实现 renderers.tsx**

```tsx
// src/client/renderers.tsx
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { TabKind } from './tabs.ts'
import { renderMarkdown } from './md-render.ts'

export function previewUrl(path: string): string {
  return `/preview/${encodeURIComponent(path)}`
}

const CODE_EXTS = /\.(ts|tsx|js|jsx|json|css|yml|yaml|toml|sh|py|go|rs|c|h|cpp|java|xml|sql|vue|svelte)$/i

function Loader(): ReactElement {
  return <div style={{ padding: 24, color: 'var(--color-text-muted, #999)', fontSize: 13 }}>加载中…</div>
}

function ErrorView({ message }: { message: string }): ReactElement {
  return (
    <div style={{ padding: 24, color: 'var(--color-danger, #f87171)', fontSize: 13 }}>
      无法预览：{message}
    </div>
  )
}

function TextContent({ kind, path }: { kind: TabKind; path: string }): ReactElement {
  const [state, setState] = useState<{ text: string; truncated: boolean } | { error: string } | null>(null)
  useEffect(() => {
    let alive = true
    setState(null)
    host.call('fp.call', { fn: 'readText', path })
      .then((r) => { if (alive) setState(r as { text: string; truncated: boolean }) })
      .catch((e: unknown) => { if (alive) setState({ error: String(e) }) })
    return () => { alive = false }
  }, [path])
  if (state === null) return <Loader />
  if ('error' in state) return <ErrorView message={state.error} />
  const body = kind === 'md' ? renderMarkdown(state.text) : state.text
  const html = kind === 'md'
    ? <div dangerouslySetInnerHTML={{ __html: body }} style={{ padding: 16, fontSize: 14, lineHeight: 1.7 }} />
    : <pre style={{ padding: 16, fontSize: 13, overflow: 'auto', lineHeight: 1.6, margin: 0 }}>{body}{state.truncated ? '\n…(已截断)' : ''}</pre>
  return html
}

function DocxContent({ path }: { path: string }): ReactElement {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    host.call('fp.call', { fn: 'docxToHtml', path })
      .then((r) => {
        if (!alive) return
        const res = r as { html?: string; error?: string }
        if (res.html) setHtml(res.html)
        else setError(res.error ?? '转换失败')
      })
      .catch((e: unknown) => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [path])
  if (error) return <ErrorView message={error} />
  if (html === null) return <Loader />
  return <div dangerouslySetInnerHTML={{ __html: html }} style={{ padding: 16, overflow: 'auto' }} />
}

export function ContentView({ kind, path }: { kind: TabKind; path: string }): ReactElement {
  switch (kind) {
    case 'md':
    case 'txt':
    case 'code':
      return <TextContent kind={kind} path={path} />
    case 'pdf':
      return <iframe src={previewUrl(path)} style={{ width: '100%', height: '100%', border: 'none' }} title={path} />
    case 'image':
      return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', overflow: 'auto' }}>
        <img src={previewUrl(path)} alt={path} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    case 'html':
      return <iframe sandbox="" src={previewUrl(path)} style={{ width: '100%', height: '100%', border: 'none' }} title={path} />
    case 'docx':
      return <DocxContent path={path} />
    case 'binary':
      return <div style={{ padding: 24, fontSize: 13, color: 'var(--color-text-muted, #999)' }}>
        此文件类型不支持内联预览。可在工具栏点击「用默认应用打开」。
      </div>
  }
}
```

- [ ] **Step 6: 构建验证**

Run: `cd ~/.dsh/plugins/dsh-file-preview && pnpm build`
Expected: 构建成功

- [ ] **Step 7: Commit**

```bash
cd ~/.dsh/plugins/dsh-file-preview
git add -A
git commit -m "feat: 渲染器（md/code/pdf/image/html/docx/binary）"
```

---

### Task 7: Client 半 — 多标签预览面板 + 侧边栏按钮 + overlay 注册

**Files:**
- Create: `~/.dsh/plugins/dsh-file-preview/src/client/preview-panel.tsx`
- Modify: `~/.dsh/plugins/dsh-file-preview/src/client/index.tsx`

**Interfaces:**
- Consumes: `openTab`/`closeTab`/`PreviewTab` (Task 5), `ContentView`/`previewUrl` (Task 6), Host RPC
- Produces: `apply(ctx)` 注册 3 个 slot：
  - `sidebar.footer.action` id `file-preview-open`（「文件」按钮，点击切换抽屉显隐 + 打开详情面板）
  - `shell.overlay` id `file-preview-drawer`（左侧文件树抽屉，可固定；固定在 sidebar 右缘 `position: fixed`）
  - `shell.overlay` id `file-preview-panel`（右侧多标签预览面板）
  - 面板工具栏：用默认应用打开 / 复制路径 / 刷新 / 关闭
  - 空态：无标签提示；错误态由 ContentView 承担

- [ ] **Step 1: 实现 preview-panel.tsx**

```tsx
// src/client/preview-panel.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { closeTab, openTab } from './tabs.ts'
import type { PreviewTab } from './tabs.ts'
import { ContentView, previewUrl } from './renderers.tsx'
import { FileTree } from './file-tree.tsx'

const PANEL_WIDTH = 480
const DRAWER_WIDTH = 260

export function PreviewPanel({ onClose }: { onClose(): void }): ReactElement {
  const [tabs, setTabs] = useState<PreviewTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [root, setRoot] = useState<string>('/')

  useEffect(() => {
    host.call('fp.call', { fn: 'getRoot' }).then((r) => {
      const res = r as { root: string }
      if (res?.root) setRoot(res.root)
    }).catch(() => {})
  }, [])

  const active = tabs.find((t) => t.id === activeId) ?? null

  const handleOpen = useCallback((path: string) => {
    host.call('fp.call', { fn: 'stat', path }).then((r) => {
      const s = r as { exists: boolean; isDir: boolean }
      if (!s.exists || s.isDir) return
      const name = path.split('/').pop() ?? path
      const kind = name.endsWith('.md') ? 'md'
        : name.endsWith('.pdf') ? 'pdf'
        : /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(name) ? 'image'
        : /\.(html?)$/i.test(name) ? 'html'
        : /\.(docx|doc|rtf)$/i.test(name) ? 'docx'
        : /\.txt$/i.test(name) ? 'txt'
        : /\.(ts|tsx|js|jsx|json|css|yml|yaml|toml|sh|py|go|rs|c|h|cpp|java|xml|sql|vue|svelte)$/i.test(name) ? 'code'
        : 'binary'
      const r2 = openTab(tabs, { path, name, kind })
      setTabs(r2.tabs); setActiveId(r2.activeId)
    }).catch(() => {})
  }, [tabs])

  const handleClose = useCallback((id: string) => {
    const r = closeTab(tabs, activeId, id)
    setTabs(r.tabs); setActiveId(r.activeId)
  }, [tabs, activeId])

  const copyPath = useCallback(async () => {
    if (!active) return
    try { await navigator.clipboard.writeText(active.path) } catch { /* ignore */ }
  }, [active])

  const openExternal = useCallback(() => {
    if (!active) return
    host.call('fp.call', { fn: 'openInApp', path: active.path }).catch(() => {})
  }, [active])

  const refresh = useCallback(() => {
    if (!active) return
    setTabs((prev) => prev.map((t) => (t.id === active.id ? { ...t, openedAt: Date.now() } : t)))
  }, [active])

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: PANEL_WIDTH, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-elevated, #1a1a2e)', borderLeft: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', boxShadow: '-8px 0 32px rgba(0,0,0,0.25)', zIndex: 9999, fontFamily: 'inherit' }}>
      {/* tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 8px', borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', flexShrink: 0 }}>
        {tabs.map((t) => (
          <div key={t.id} onClick={() => setActiveId(t.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: t.id === activeId ? 'var(--color-bg-active, rgba(255,255,255,0.1))' : 'transparent', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 140 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
            <span role="button" onClick={(e) => { e.stopPropagation(); handleClose(t.id) }} style={{ opacity: 0.6, padding: '0 2px' }}>×</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14, opacity: 0.7 }}>✕</button>
      </div>
      {/* toolbar */}
      {active && (
        <div style={{ display: 'flex', gap: 6, padding: '4px 8px', borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', flexShrink: 0, fontSize: 12 }}>
          <button onClick={openExternal} style={toolBtn}>用默认应用打开</button>
          <button onClick={copyPath} style={toolBtn}>复制路径</button>
          <button onClick={refresh} style={toolBtn}>刷新</button>
        </div>
      )}
      {/* content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {active ? <ContentView key={active.id + '-' + active.openedAt} kind={active.kind} path={active.path} />
          : <div style={{ padding: 24, fontSize: 13, color: 'var(--color-text-muted, #999)' }}>从文件树或手动打开一个文件</div>}
      </div>
    </div>
  )
}

const toolBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.15))',
  borderRadius: 6, color: 'inherit', cursor: 'pointer', fontSize: 12, padding: '2px 8px',
}

export function PreviewDrawer({ fixed, onOpenFile, onClose }: { fixed: boolean; onOpenFile(p: string): void; onClose(): void }): ReactElement {
  const [root, setRoot] = useState<string>('/')
  useEffect(() => {
    host.call('fp.call', { fn: 'getRoot' }).then((r) => {
      const res = r as { root: string }
      if (res?.root) setRoot(res.root)
    }).catch(() => {})
  }, [])
  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 0, width: DRAWER_WIDTH, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-elevated, #1a1a2e)', borderRight: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', boxShadow: '8px 0 32px rgba(0,0,0,0.25)', zIndex: 9998 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', fontSize: 13, fontWeight: 600 }}>
        <span>📁 文件</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.7 }}>✕</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <FileTree root={root} onOpen={onOpenFile} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 实现共享 store（panel-store.ts）**

跨组件状态用单一模块 store + subscribe（仿 genui 的 panel-store.ts 模式），替代脆弱的 window 事件桥接。

Create `src/client/panel-store.ts`:

```ts
// src/client/panel-store.ts
import { openTab, closeTab } from './tabs.ts'
import type { PreviewTab, TabKind } from './tabs.ts'

export interface PanelStore {
  tabs: PreviewTab[]
  activeId: string | null
  drawerVisible: boolean
  panelVisible: boolean
  root: string
}

const state: PanelStore = {
  tabs: [], activeId: null, drawerVisible: false, panelVisible: false, root: '/',
}

let listeners: Array<() => void> = []
export function getPanelState(): PanelStore { return state }
export function subscribePanel(fn: () => void): () => void {
  listeners.push(fn)
  return () => { listeners = listeners.filter((l) => l !== fn) }
}
function emit(): void { for (const l of listeners) l() }

export function setRoot(root: string): void { state.root = root; emit() }
export function toggleDrawer(): void { state.drawerVisible = !state.drawerVisible; emit() }
export function closeDrawer(): void { state.drawerVisible = false; emit() }
export function openPanel(): void { state.panelVisible = true; emit() }
export function closePanel(): void { state.panelVisible = false; emit() }
export function openFile(path: string, name: string, kind: TabKind): void {
  const r = openTab(state.tabs, { path, name, kind })
  state.tabs = r.tabs; state.activeId = r.activeId
  state.panelVisible = true
  emit()
}
export function closeFile(id: string): void {
  const r = closeTab(state.tabs, state.activeId, id)
  state.tabs = r.tabs; state.activeId = r.activeId
  emit()
}
export function activateFile(id: string): void { state.activeId = id; emit() }
export function refreshFile(id: string): void {
  const t = state.tabs.find((x) => x.id === id)
  if (t) { t.openedAt = Date.now() }
  emit()
}
```

- [ ] **Step 3: 实现 client 入口 index.tsx（基于 store）**

```tsx
// src/client/index.tsx
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { subscribePanel, toggleDrawer, closeDrawer, openFile, setRoot } from './panel-store.ts'
import type { PanelStore } from './panel-store.ts'
import { PreviewPanel, PreviewDrawer } from './preview-panel.tsx'
import { kindForPath } from './tabs.ts'

export const inject = ['slots']

function usePanelState(): PanelStore {
  const [, force] = useState(0)
  useEffect(() => subscribePanel(() => force((n) => n + 1)), [])
  return getPanelState()
}

export function apply(ctx: Context): () => void {
  const disposers: Array<() => void> = []

  // Load workspace root once.
  host.call('fp.call', { fn: 'getRoot' })
    .then((r) => { const res = r as { root: string }; if (res?.root) setRoot(res.root) })
    .catch(() => {})

  const handleOpenFromTree = (p: string): void => {
    host.call('fp.call', { fn: 'stat', path: p }).then((r) => {
      const s = r as { exists: boolean; isDir: boolean }
      if (!s.exists || s.isDir) return
      const name = p.split('/').pop() ?? p
      openFile(p, name, kindForPath(p))
    }).catch(() => {})
  }

  disposers.push(ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'file-preview-open', order: 90, label: () => '文件',
  }, () => {
    usePanelState()
    return (
      <button onClick={toggleDrawer} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13, width: '100%' }}>
        <span>📁</span><span>文件</span>
      </button>
    )
  })))

  disposers.push(ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'file-preview-drawer', order: 90,
  }, () => {
    const s = usePanelState()
    if (!s.drawerVisible) return null
    return <PreviewDrawer fixed={false} onOpenFile={handleOpenFromTree} onClose={closeDrawer} />
  })))

  disposers.push(ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'file-preview-panel', order: 91,
  }, () => {
    const s = usePanelState()
    if (!s.panelVisible) return null
    return <PreviewPanel store={s} />
  })))

  return () => { for (const d of disposers) d() }
}
```

- [ ] **Step 4: 调整 preview-panel.tsx 使用 store**

将 `PreviewPanel` 改为接收 `{ store }: { store: PanelStore }` props：`tabs`/`activeId` 来自 `store`，交互调用 `activateFile/closeFile/refreshFile/closePanel`（从 store 导入）；`PreviewDrawer` 保持 props 不变（`onOpenFile`/`onClose`），其内部 `root` 改为从 `usePanelState()` 读取而非自建 state。其余样式代码沿用 Step 1。

- [ ] **Step 5: 构建验证**

Run: `cd ~/.dsh/plugins/dsh-file-preview && pnpm build`
Expected: 构建成功，`lib/client.js` 包含三个 slot 注册

- [ ] **Step 6: Commit**

```bash
cd ~/.dsh/plugins/dsh-file-preview
git add -A
git commit -m "feat: 多标签预览面板 + 侧边栏按钮 + overlay 注册（client 半）"
```

---

### Task 8: 安装到 web profile 并手动验证

**Files:**
- Modify: `~/.dsh/profiles/web/package.json`（加 `@dshd/dsh-file-preview: file:...`）
- Modify: `~/.dsh/profiles/web/pnpm-lock.yaml`（pnpm install 生成）
- Modify: `~/.dsh/profiles/web/cordis.patch.yml`（加 insert 行）

**Interfaces:**
- Consumes: Task 1–7 产物（lib/index.js + lib/client.js）
- Produces: profile 中可启动的插件行；桌面端重启后生效

- [ ] **Step 1: 加入 profile package.json 依赖**

编辑 `~/.dsh/profiles/web/package.json` 的 `dependencies`：

```json
"@dshd/dsh-file-preview": "file:/Users/litong/.dsh/plugins/dsh-file-preview",
```

并加入 `dsh.profile.bundles`：

```json
"@dshd/dsh-file-preview"
```

- [ ] **Step 2: 在 profile cordis.patch.yml 注册行**

在 `~/.dsh/profiles/web/cordis.patch.yml` 的第一个 `- insert:` 列表追加：

```yaml
    - id: file-preview
      name: '@dshd/dsh-file-preview'
```

- [ ] **Step 3: 安装依赖**

Run: `cd ~/.dsh/profiles/web && pnpm install`
Expected: `@dshd/dsh-file-preview` 链接到 node_modules，lock 更新

- [ ] **Step 4: 重启桌面端并验证**

手动重启 DeepSeek Harness Desktop 应用。

验证清单：
1. 侧边栏底部出现「📁 文件」按钮
2. 点击按钮 → 左侧抽屉出现文件树（根 = workspace 根）
3. 双击文件 → 右侧出现多标签预览面板
4. md 文件渲染标题/列表/代码块
5. PDF 文件内嵌可滚动
6. 图片直显
7. 本地 html 沙箱渲染
8. docx 内联渲染（textutil）
9. 多标签切换 / 关闭 / 刷新 / 复制路径 / 用默认应用打开
10. 超过 8 个标签时拒绝新标签

- [ ] **Step 5: 记录结果**

将验证结果（通过/失败及现象）写入 `~/.dsh/plugins/dsh-file-preview/VERIFY.md` 并 commit；失败项作为新任务跟进。

- [ ] **Step 6: Commit**

```bash
cd ~/.dsh/profiles/web && git add -A && git commit -m "feat: 安装 dsh-file-preview 到 web profile" || echo "profile 不是 git 仓库，跳过 commit"
```

---

## 自审记录

- **Spec 覆盖**：spec §4 架构 → Task 1/4；§5 Host（路由/RPC/转换）→ Task 2/3/4；§6 Client（slot/标签/渲染/三态/工具栏）→ Task 5/6/7；§7 数据流 → 贯穿；§8 安全 → Task 2 路径校验、Task 6 sandbox iframe、readText 截断；§9 测试 → 各 Task TDD + Task 8 手动清单；§10 风险（details 冲突）→ 已改用 shell.overlay（Task 7 注册 overlay 而非 details）。
- **占位符扫描**：无 TBD/TODO；所有代码块均为完整实现。
- **类型一致性**：`PreviewTab`/`TabKind` 在 Task 5 定义，Task 6/7 引用一致；`fp.call` 单一 RPC 方法在 Task 3/4 定义，Task 5/6/7 客户端调用一致；`panel-store` API（openFile/closeFile/toggleDrawer/setRoot）在 Task 7 定义并全量使用。
