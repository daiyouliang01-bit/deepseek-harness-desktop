export type VerifyKind = 'test' | 'lint' | 'typecheck' | 'build'
export type VerifyResult = { kind: VerifyKind; command: string; ok: boolean; output: string }

const KIND_ALIASES: Record<string, VerifyKind> = {
  test: 'test',
  lint: 'lint',
  typecheck: 'typecheck',
  'type-check': 'typecheck',
  build: 'build',
}

const KIND_ORDER: VerifyKind[] = ['test', 'lint', 'typecheck', 'build']
const OUTPUT_CAP = 8000
const AUTO_FIX_CAP = 2

export function detectVerifyCommands(manifest: { scripts?: Record<string, string> }): VerifyKind[] {
  const scripts = manifest.scripts ?? {}
  const found = new Set<VerifyKind>()
  for (const name of Object.keys(scripts)) {
    const kind = KIND_ALIASES[name]
    if (kind) found.add(kind)
  }
  return KIND_ORDER.filter((kind) => found.has(kind))
}

export function resolveNpmVerifyCommands(
  scripts: Record<string, string> | undefined,
): Partial<Record<VerifyKind, string>> {
  return resolveVerifyCommands(scripts, 'npm')
}

/**
 * Resolve verify commands for the project's actual package manager. A
 * `pnpm-lock.yaml` prefers pnpm, `yarn.lock` prefers yarn, otherwise npm.
 */
export function resolveVerifyCommands(
  scripts: Record<string, string> | undefined,
  lockfile: 'npm' | 'pnpm' | 'yarn' = 'npm',
): Partial<Record<VerifyKind, string>> {
  if (!scripts) return {}
  const runner = lockfile === 'pnpm' ? 'pnpm run' : lockfile === 'yarn' ? 'yarn run' : 'npm run'
  const cmds: Partial<Record<VerifyKind, string>> = {}
  for (const [name, kind] of Object.entries(KIND_ALIASES)) {
    if (scripts[name] && !cmds[kind]) cmds[kind] = `${runner} ${name}`
  }
  return cmds
}

/** Detect the package manager from an existing lockfile path list. */
export function detectLockfile(files: Array<string | undefined>): 'npm' | 'pnpm' | 'yarn' {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm'
  if (files.includes('yarn.lock')) return 'yarn'
  return 'npm'
}

export class Verifier {
  autoFixAttempts = 0
  #lastResult: VerifyResult[] | null = null
  #run: (cmd: string) => Promise<{ ok: boolean; output: string }>

  constructor(run: (cmd: string) => Promise<{ ok: boolean; output: string }>) {
    this.#run = run
  }

  lastResult(): VerifyResult[] | null {
    return this.#lastResult
  }

  tryAutoFix(): boolean {
    if (this.autoFixAttempts >= AUTO_FIX_CAP) return false
    this.autoFixAttempts += 1
    return true
  }

  async runAll(cmds: Partial<Record<VerifyKind, string>>): Promise<VerifyResult[]> {
    const results: VerifyResult[] = []
    for (const kind of KIND_ORDER) {
      const command = cmds[kind]
      if (!command) continue
      const raw = await this.#run(command)
      results.push({
        kind,
        command,
        ok: raw.ok,
        output: raw.output.slice(0, OUTPUT_CAP),
      })
    }
    this.#lastResult = results
    return results
  }
}
