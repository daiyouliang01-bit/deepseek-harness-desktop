import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = join(desktopRoot, '../..')
const entry = join(repoRoot, 'packages/harness-adapter/src/process-bridge.ts')
const outfile = join(desktopRoot, 'plugins/dsh-coding-agent/lib/process-bridge.js')

async function loadEsbuild() {
  try {
    return await import('esbuild')
  } catch {
    /* fall through */
  }
  const require = createRequire(join(desktopRoot, 'package.json'))
  try {
    return require('esbuild')
  } catch {
    /* fall through */
  }
  const pnpm = join(repoRoot, 'node_modules/.pnpm')
  const dir = readdirSync(pnpm).find((name) => name.startsWith('esbuild@'))
  if (!dir) throw new Error('esbuild is not installed in this workspace')
  return import(pathToFileURL(join(pnpm, dir, 'node_modules/esbuild/lib/main.js')).href)
}

const esbuild = await loadEsbuild()
const build = esbuild.buildSync ?? esbuild.default?.buildSync
if (typeof build !== 'function') {
  const bin = join(repoRoot, 'node_modules/.pnpm')
  const dir = readdirSync(bin).find((name) => name.startsWith('esbuild@'))
  const cli = join(bin, dir, 'node_modules/esbuild/bin/esbuild')
  const result = spawnSync(
    cli,
    [entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${outfile}`],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
} else {
  build({
    absWorkingDir: desktopRoot,
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'info',
  })
}
