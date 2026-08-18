/**
 * Verify dependency licenses for the packaged app (macOS release gate).
 *
 * Parses pnpm-lock.yaml at the repo root, resolves each package's license
 * from its package.json in the virtual store, and fails on non-permissive or
 * unknown licenses (MIT/Apache-2.0/BSD/ISC/0BSD/MPL-2.0 allowed).
 *
 * Usage: node scripts/verify-licenses.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = join(ROOT, 'pnpm-lock.yaml')
const STORE = join(ROOT, 'node_modules', '.pnpm')

const PERMISSIVE_ANY = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'MPL-2.0', 'CC0-1.0', 'WTFPL', 'BlueOak-1.0.0',
  // triaged: Python-2.0 (PSF, argparse — permissive OSI), CC-BY-4.0
  // (caniuse-lite database — standard for browser-compat data, ships in
  // vite/electron toolchains with attribution)
  'Python-2.0', 'CC-BY-4.0']
/** Accept a bare permissive license or an SPDX expression containing one (X OR Y). */
function isPermissive(license) {
  const l = String(license)
  if (/^[A-Za-z0-9.-]+$/.test(l)) return PERMISSIVE_ANY.includes(l)
  return PERMISSIVE_ANY.some((p) => l.split(/\s+/).some((tok) => tok.replace(/[()]/g, '') === p))
}

if (!existsSync(LOCK)) {
  console.error('verify-licenses: pnpm-lock.yaml not found at ' + LOCK)
  process.exit(1)
}

const text = readFileSync(LOCK, 'utf8')
// pnpm v11 keys: `  name@version(peer@peerver):` — version ends at `(` or `:`
const lineRe = /^\s{2}([@a-z0-9][a-z0-9._/-]*)@([0-9][^(:]*):/
const entries = new Map()
for (const line of text.split(/\r?\n/)) {
  const m = lineRe.exec(line)
  if (m) entries.set(`${m[1]}@${m[2]}`, { name: m[1], version: m[2] })
}

function licenseOf(name, version) {
  const esc = name.replace(/\//g, '+')
  let dir = null
  try {
    const match = readdirSync(STORE).find((d) => d.startsWith(`${esc}@${version}`))
    dir = match ? join(STORE, match, 'node_modules', name) : null
  } catch {
    dir = null
  }
  // Not installed in this platform's virtual store → a platform-skipped
  // optional dependency that never ships in the mac package: skip it.
  if (!dir) return 'SKIP'
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return pkg.license
  } catch {
    return 'UNKNOWN'
  }
}

let failures = 0
let checked = 0
for (const [, e] of entries) {
  const license = licenseOf(e.name, e.version)
  checked++
  if (license === 'SKIP') continue
  if (!isPermissive(license)) {
    failures++
    console.error(`  ✗ ${e.name}@${e.version} license=${license}`)
  }
}
console.log(`verify-licenses: checked ${checked} packages, ${failures} non-permissive`)
if (failures > 0) {
  console.error('verify-licenses: FAIL — non-permissive licenses found (triage before release)')
  process.exit(1)
}
console.log('verify-licenses: OK')
