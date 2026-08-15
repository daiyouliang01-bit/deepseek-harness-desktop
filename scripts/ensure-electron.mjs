/**
 * Ensures the Electron binary is present after `pnpm install`.
 *
 * pnpm's build-script allowlist runs electron's postinstall, but the default
 * download host (GitHub releases) is unreachable on some networks. When the
 * binary is missing (path.txt absent or its target gone), this hook downloads
 * it through mirrors. Idempotent: skips when the binary already exists.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const electronDir = join(process.cwd(), 'apps/desktop/node_modules/electron')

function binaryPresent() {
  try {
    const rel = readFileSync(join(electronDir, 'path.txt'), 'utf8').trim()
    return rel.length > 0 && existsSync(join(electronDir, 'dist', rel))
  } catch {
    return false
  }
}

if (!existsSync(electronDir)) {
  console.log('[ensure-electron] electron package not installed yet — skipping')
  process.exit(0)
}

if (binaryPresent()) {
  console.log('[ensure-electron] binary present')
  process.exit(0)
}

console.log('[ensure-electron] electron binary missing — downloading via mirrors…')
const mirrors = [
  'https://npmmirror.com/mirrors/electron/',
  'https://mirrors.huaweicloud.com/electron/',
  'https://github.com/electron/electron/releases/download/'
]
for (const mirror of mirrors) {
  console.log(`[ensure-electron] trying mirror: ${mirror}`)
  const r = spawnSync(process.execPath, [join(electronDir, 'install.js')], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_MIRROR: mirror }
  })
  if (r.status === 0 && binaryPresent()) {
    console.log('[ensure-electron] ok')
    process.exit(0)
  }
}
console.error(
  '[ensure-electron] all mirrors failed. Run manually:\n' +
    '  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node apps/desktop/node_modules/electron/install.js'
)
process.exit(1)
