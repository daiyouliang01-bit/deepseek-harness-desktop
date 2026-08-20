/**
 * Verify a packaged macOS .app's self-contained runtime and assets.
 *
 * Usage: node scripts/verify-packaged-runtime.mjs [<path-to-.app>]
 * Defaults to release/mac-arm64/DeepSeek Harness Desktop.app
 *
 * Checks (macOS-only, modeled on anywhere-labs verify-packaged-runtime):
 * 1. The .app bundle exists and has Contents/Resources.
 * 2. The bundled node is a Mach-O executable for the expected arch.
 * 3. The bundled dsh closure's bin.js exists.
 * 4. desktop-tools.patch.yml (outside asar) exists.
 * 5. icon.icns exists.
 * 6. No foreign-platform binaries are bundled in runtime (only darwin).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = process.argv[2] ?? 'release/mac-arm64/DeepSeek Harness Desktop.app'
const RES = join(APP, 'Contents/Resources')

let failures = 0
function check(name, ok, detail = '') {
  if (ok) console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`)
  else {
    failures++
    console.error(`  ✗ ${name}${detail ? ` (${detail})` : ''}`)
  }
}

console.log(`verify-packaged-runtime: ${APP}`)
if (!existsSync(APP)) {
  console.error(`✗ app bundle not found: ${APP}`)
  process.exit(1)
}
check('app bundle exists', true)

const runtimeDir = join(RES, 'runtime')
check('runtime/ dir exists', existsSync(runtimeDir))

const nodeBin = join(runtimeDir, 'node')
if (existsSync(nodeBin)) {
  let isMachO = false
  let arch = ''
  try {
    const out = execFileSync('file', [nodeBin], { encoding: 'utf8' })
    isMachO = out.includes('Mach-O')
    arch = /arm64|x86_64/.exec(out)?.[0] ?? ''
  } catch {
    /* file unavailable */
  }
  check('runtime/node is a Mach-O executable', isMachO, arch)
} else {
  check('runtime/node exists', false)
}

const dshBinJs = join(runtimeDir, 'dsh-cli', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
check('bundled dsh bin.js exists', existsSync(dshBinJs))

const patchPath = join(RES, 'desktop-tools.patch.yml')
check('desktop-tools.patch.yml (outside asar)', existsSync(patchPath))
if (existsSync(patchPath)) {
  const patch = readFileSync(patchPath, 'utf8')
  check('patch inserts coding-agent host row', /id:\s*coding-agent/.test(patch) && /insert:/.test(patch))
}
check('packaged coding-agent plugin', existsSync(join(RES, 'plugins/dsh-coding-agent/lib/index.js')))
check('packaged coding-agent bundle', existsSync(join(RES, 'plugins/dsh-coding-agent/lib/process-bridge.js')))
// The plugin runs an esbuild bundle of packages/harness-adapter/src; if the
// source is newer than the bundled file the plugin silently runs stale code.
{
  const bundled = join(RES, 'plugins/dsh-coding-agent/lib/process-bridge.js')
  // scripts/ → desktop → apps → repo root (4 levels up from the script file).
  const source = join(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), 'packages/harness-adapter/src/process-bridge.ts')
  const fresh = existsSync(bundled) && existsSync(source) && statSync(bundled).mtimeMs >= statSync(source).mtimeMs
  check('coding-agent bundle is newer than its TS source', fresh)
}
check('packaged project-onboarding skill', existsSync(join(RES, 'skills/project-onboarding/SKILL.md')))
check('packaged verify-before-complete skill', existsSync(join(RES, 'skills/verify-before-complete/SKILL.md')))
check('packaged small-safe-edits skill', existsSync(join(RES, 'skills/small-safe-edits/SKILL.md')))
check('icon.icns', existsSync(join(RES, 'icon.icns')))

// Foreign-platform binaries in the bundled runtime would bloat the app and
// could carry wrong prebuilds. Only darwin should be present.
if (existsSync(runtimeDir)) {
  const foreign = readdirSync(runtimeDir).filter((f) => /win|linux|\.exe$/i.test(f))
  check('no foreign-platform files in runtime', foreign.length === 0, foreign.join(', '))
}

if (failures > 0) {
  console.error(`\n✗ ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\n✓ all checks passed')
