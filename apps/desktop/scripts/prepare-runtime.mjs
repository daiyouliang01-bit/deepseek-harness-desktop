/**
 * Task 1.4 / Task 2.3 — prepare the self-contained dsh runtime for packaging.
 *
 * Dev builds (--release absent): verify a `dsh` CLI is available on PATH or
 * the global npm bin. Development still relies on the user's dsh install.
 *
 * Release builds (--release): materialize a fully self-contained runtime into
 * build/runtime/ — a pinned Node binary plus an npm-installed @deepseek-ai/dsh
 * tree (with node-pty/sharp prebuilds). electron-builder picks it up via
 * extraResources so the packaged .app needs no dsh/Node on the user's PATH
 * (ADR-002). The runtime is independent of ~/.dsh (D1: only user data is
 * shared, not the runtime binaries).
 *
 * Usage: node scripts/prepare-runtime.mjs [--release]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync as fsChmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync as fsRenameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DESKTOP_DIR = join(__dirname, '..')
const MANIFEST_PATH = join(DESKTOP_DIR, 'runtime-manifest.json')
const BUILD_RUNTIME_DIR = join(DESKTOP_DIR, 'build', 'runtime')

const isRelease = process.argv.includes('--release')

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`runtime-manifest.json not found at ${MANIFEST_PATH}`)
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

// ----- shared helpers -----

function onPath(bin) {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/** Find `dsh` for dev builds: PATH first, then common global npm bin layouts. */
function findDsh() {
  if (process.env.DSHD_DSH_BIN) return process.env.DSHD_DSH_BIN
  if (onPath('dsh')) return 'dsh'
  const candidates = []
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 10_000 }).trim()
    candidates.push(join(root, '.bin'))
  } catch {
    /* npm unavailable */
  }
  candidates.push(join(homedir(), 'node_modules', '.bin'))
  candidates.push('/usr/local/bin')
  for (const binDir of candidates) {
    const candidate = join(binDir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
    if (existsSync(candidate)) return candidate
  }
  return null
}

function dshVersion(bin) {
  return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim()
}

/** major.minor of a dsh version string (0.1.0-rc.7 → 0.1). */
function majorMinor(v) {
  const m = /^(\d+)\.(\d+)/.exec(v)
  return m ? `${m[1]}.${m[2]}` : null
}

// ----- release: download Node -----

/**
 * Download a pinned Node binary (plus its bundled npm) into build/runtime/.
 * Layout after extraction mirrors the official tarball's relevant subset:
 *   build/runtime/node                       (POSIX) / node.exe (Windows)
 *   build/runtime/lib/node_modules/npm/...   (npm, so installDsh can run it)
 * Returns the absolute path to the node executable.
 */
function downloadNode(nodeVersion, outDir) {
  const platform = process.platform === 'win32' ? 'win' : process.platform
  const arch = process.arch
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const distName = `node-v${nodeVersion}-${platform}-${arch}`
  const archiveName = `${distName}.${ext}`
  const url = `https://nodejs.org/dist/v${nodeVersion}/${archiveName}`

  const nodeBinPath = join(outDir, process.platform === 'win32' ? 'node.exe' : 'node')
  const npmCliPath = join(outDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')

  // Cache: if both node and npm are already present, skip.
  if (existsSync(nodeBinPath) && existsSync(npmCliPath)) {
    console.log(`[prepare-runtime] node ${nodeVersion} + npm already present at ${outDir}`)
    return nodeBinPath
  }

  mkdirSync(outDir, { recursive: true })
  const archivePath = join(outDir, archiveName)

  console.log(`[prepare-runtime] downloading ${url}`)
  downloadToFile(url, archivePath)

  console.log(`[prepare-runtime] extracting node + npm from ${archiveName}`)
  if (process.platform === 'win32') {
    // Windows layout: node_modules/npm and node.exe at the archive root.
    execFileSync('tar', ['-xf', archivePath, '-C', outDir,
      `${distName}/node.exe`,
      `${distName}/node_modules/npm`
    ], { stdio: 'inherit' })
    const nestedNode = join(outDir, distName, 'node.exe')
    const nestedNpm = join(outDir, distName, 'node_modules', 'npm')
    if (existsSync(nestedNode)) renameSyncForce(nestedNode, nodeBinPath)
    // Windows has no lib/; npm lives under node_modules/. Mirror the POSIX
    // layout by placing npm under lib/node_modules so installDsh's candidate
    // paths stay platform-agnostic.
    const npmDest = join(outDir, 'lib', 'node_modules', 'npm')
    mkdirSync(dirname(npmDest), { recursive: true })
    if (existsSync(nestedNpm)) renameSyncForce(nestedNpm, npmDest)
    rmSync(join(outDir, distName), { recursive: true, force: true })
  } else {
    // POSIX: bin/node + lib/node_modules/npm.
    execFileSync('tar', ['-xzf', archivePath, '-C', outDir,
      `${distName}/bin/node`,
      `${distName}/lib/node_modules/npm`
    ], { stdio: 'inherit' })
    const nestedNode = join(outDir, distName, 'bin', 'node')
    const nestedNpmDir = join(outDir, distName, 'lib', 'node_modules', 'npm')
    const npmDestDir = join(outDir, 'lib', 'node_modules', 'npm')
    if (existsSync(nestedNode)) renameSyncForce(nestedNode, nodeBinPath)
    mkdirSync(join(outDir, 'lib', 'node_modules'), { recursive: true })
    if (existsSync(nestedNpmDir)) renameSyncForce(nestedNpmDir, npmDestDir)
    rmSync(join(outDir, distName), { recursive: true, force: true })
    fsChmodSync(nodeBinPath, 0o755)
  }
  rmSync(archivePath, { force: true })

  if (!existsSync(nodeBinPath)) {
    throw new Error(`failed to extract node binary to ${nodeBinPath}`)
  }
  if (!existsSync(npmCliPath)) {
    throw new Error(`failed to extract npm to ${npmCliPath}`)
  }
  // Sanity check the bundled node runs and reports the expected version.
  const got = execFileSync(nodeBinPath, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim()
  if (got !== `v${nodeVersion}`) {
    throw new Error(`bundled node version mismatch: expected v${nodeVersion}, got ${got}`)
  }
  console.log(`[prepare-runtime] node ${got} + npm materialized at ${outDir}`)
  return nodeBinPath
}

function downloadToFile(url, dest) {
  // Stream via fetch (Node 18+) into a buffer, then write once. Keeps the
  // helper sync-friendly while still streaming the body chunk-by-chunk.
  const res = spawnSync(process.execPath, ['-e', `
    fetch(${JSON.stringify(url)}).then(async (r) => {
      if (!r.ok) { console.error('HTTP ' + r.status); process.exit(1); }
      const buf = Buffer.from(await r.arrayBuffer());
      require('node:fs').writeFileSync(${JSON.stringify(dest)}, buf);
    }).catch((e) => { console.error(String(e)); process.exit(1); });
  `], { stdio: 'inherit' })
  if (res.status !== 0) throw new Error(`download failed: ${url}`)
  if (!existsSync(dest) || statSync(dest).size === 0) throw new Error(`download produced empty file: ${dest}`)
}

function renameSyncForce(from, to) {
  // renameSync overwrites on POSIX when the target is on the same volume; on
  // Windows a pre-existing target must be removed first.
  try { rmSync(to, { force: true }) } catch { /* ignore */ }
  fsRenameSync(from, to)
}

// ----- release: install dsh -----

/**
 * npm-install the pinned @deepseek-ai/dsh into build/runtime/dsh-cli so the
 * packaged app can spawn build/runtime/node build/runtime/dsh-cli/bin.js web.
 * Uses the bundled node to run npm (via its npm-cli.js), guaranteeing prebuilds
 * match the bundled Node ABI. Returns the absolute path to the dsh bin entry.
 */
function installDsh(manifest, nodeBinPath, outDir) {
  const dshDir = join(outDir, 'dsh-cli')
  const pkg = manifest.dsh.package
  const ver = manifest.dsh.version
  const spec = `${pkg}@${ver}`
  const binPath = join(dshDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

  // Cache: if already installed at the right version, skip.
  if (existsSync(binPath)) {
    try {
      const got = execFileSync(nodeBinPath, [binPath, '--version'], { encoding: 'utf8', timeout: 10_000 }).trim()
      if (got === ver) {
        console.log(`[prepare-runtime] dsh ${ver} already installed at ${dshDir}`)
        return binPath
      }
    } catch { /* fall through to reinstall */ }
  }

  // Locate npm-cli.js shipped inside the Node tarball (lib/node_modules/npm).
  // nodeBinPath is build/runtime/node, so npm lives at build/runtime/lib/...
  const nodeDir = dirname(nodeBinPath)
  const npmCliCandidates = [
    join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ]
  const npmCli = npmCliCandidates.find((p) => existsSync(p))
  if (!npmCli) {
    throw new Error(
      `npm-cli.js not found next to bundled node ${nodeBinPath}. ` +
      `Looked in: ${npmCliCandidates.join(', ')}`
    )
  }

  rmSync(dshDir, { recursive: true, force: true })
  mkdirSync(dshDir, { recursive: true })
  // Write an isolated package.json so npm does not walk up to the monorepo
  // root (whose workspace: deps would trigger EUNSUPPORTEDPROTOCOL).
  writeFileSync(join(dshDir, 'package.json'), JSON.stringify({
    name: 'dshd-runtime-dsh-cli',
    version: '0.0.0',
    private: true
  }, null, 2))

  const registry = manifest.registry || 'https://registry.npmjs.org'
  console.log(`[prepare-runtime] npm install ${spec} into ${dshDir} (registry ${registry})`)

  // Run npm via the bundled node + npm-cli.js. This guarantees native prebuilds
  // (node-pty/sharp) target the bundled Node, not the host.
  execFileSync(nodeBinPath, [
    npmCli,
    'install', spec,
    '--no-audit', '--no-fund',
    '--omit=dev',
    `--registry=${registry}`,
    '--no-save'
  ], { cwd: dshDir, stdio: 'inherit', env: { ...process.env } })

  if (!existsSync(binPath)) {
    throw new Error(`dsh bin entry not found after install: ${binPath}`)
  }
  const got = execFileSync(nodeBinPath, [binPath, '--version'], { encoding: 'utf8', timeout: 10_000 }).trim()
  if (got !== ver) {
    throw new Error(`installed dsh version mismatch: expected ${ver}, got ${got}`)
  }
  console.log(`[prepare-runtime] dsh ${got} installed at ${binPath}`)
  return binPath
}

// ----- main -----

try {
  if (isRelease) {
    const manifest = readManifest()
    console.log(`[prepare-runtime] release mode: manifest=${MANIFEST_PATH}`)

    // Cache-aware: downloadNode/installDsh each skip when the pinned version
    // is already present, so keep the runtime dir between builds. Only
    // recreate when the node binary itself is missing.
    mkdirSync(BUILD_RUNTIME_DIR, { recursive: true })

    const nodeBinPath = downloadNode(manifest.node.version, BUILD_RUNTIME_DIR)
    const dshBinPath = installDsh(manifest, nodeBinPath, BUILD_RUNTIME_DIR)

    console.log(`[prepare-runtime] runtime ready under ${BUILD_RUNTIME_DIR}`)
    console.log(`[prepare-runtime]   node: ${nodeBinPath}`)
    console.log(`[prepare-runtime]   dsh:  ${dshBinPath}`)
  } else {
    const bin = findDsh()
    if (!bin) {
      console.error(
        '[prepare-runtime] dsh not found on PATH or in the global npm bin. ' +
          'Dev builds need a working `dsh` CLI (npm i -g @deepseek-ai/dsh).'
      )
      process.exit(1)
    }
    const version = dshVersion(bin)
    // Pinning check: warn when the dev dsh drifts from the packaged runtime's
    // pinned version — dev and release then behave differently.
    const manifest = readManifest()
    const installed = majorMinor(version)
    const pinned = majorMinor(manifest.dsh.version)
    if (installed !== pinned) {
      console.warn(
        `[prepare-runtime] ⚠ dev dsh ${version} != pinned ${manifest.dsh.version} ` +
          `(runtime-manifest.json). Dev runs ${installed}, the packaged app runs ${pinned}. ` +
          'Update runtime-manifest.json to match, or accept the difference.'
      )
    } else {
      console.log(`[prepare-runtime] dev dsh ${version} matches pinned ${manifest.dsh.version}`)
    }
    console.log(`[prepare-runtime] dev build OK — dsh available (${bin}): ${version}`)
  }
} catch (err) {
  console.error('[prepare-runtime] failed:', err instanceof Error ? err.stack || err.message : String(err))
  process.exit(1)
}
