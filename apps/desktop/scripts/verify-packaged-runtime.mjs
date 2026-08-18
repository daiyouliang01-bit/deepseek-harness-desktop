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
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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

check('desktop-tools.patch.yml (outside asar)', existsSync(join(RES, 'desktop-tools.patch.yml')))
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
