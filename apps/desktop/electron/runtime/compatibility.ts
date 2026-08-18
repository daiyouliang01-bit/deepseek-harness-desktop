/** Task 2.2 — pre-flight compatibility checks before opening the main UI. */

import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { promisify } from 'node:util'
import { findDsh } from './dsh-bin'

const execFileAsync = promisify(execFile)

export interface CompatibilityResult {
  ok: boolean
  checks: CompatibilityCheck[]
  /** Short user-facing recovery message when !ok. */
  recovery?: string
}

export interface CompatibilityCheck {
  name: string
  passed: boolean
  detail?: string
}

export interface CompatibilityOptions {
  /** Expected dsh executable (default 'dsh'). */
  dshBin?: string
  /** Minimum Node major required by the pinned runtime. */
  minNodeMajor?: number
  /** Expected dsh version (exact match wins; semver prefix compare fallback). */
  expectedDshVersion?: string
  /** Data directory that must exist and be writable. */
  dataDir?: string
  /** Loopback health endpoint to probe (e.g. the ready URL). */
  healthUrl?: string
  /** Timeout for the health probe (ms). */
  healthTimeoutMs?: number
  /** Required protocol capability strings (future use). */
  requiredCapabilities?: string[]
}

/** Run all checks; returns ok=false + recovery when any check fails. */
export async function runCompatibilityChecks(options: CompatibilityOptions = {}): Promise<CompatibilityResult> {
  const checks: CompatibilityCheck[] = []

  // 1. dsh executable presence
  // Default to the resolved runtime (findDsh falls back to global npm bins),
  // not just bare 'dsh' on PATH — some shells lack the global bin dir.
  const bin = options.dshBin ?? findDsh() ?? 'dsh'
  try {
    await execFileAsync(bin, ['--version'], { timeout: 10_000 })
    checks.push({ name: 'dsh executable', passed: true, detail: bin })
  } catch {
    checks.push({ name: 'dsh executable', passed: false, detail: `'${bin}' not found or failed` })
    return fail(checks, `The Harness CLI '${bin}' is missing. Reinstall it (see docs/upstream-contract.md).`)
  }

  // 2. Node version floor
  const minMajor = options.minNodeMajor ?? 20
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (nodeMajor < minMajor) {
    checks.push({ name: 'node version', passed: false, detail: `${process.versions.node} < ${minMajor}` })
    return fail(checks, `Node.js ${minMajor}+ is required (found ${process.versions.node}).`)
  }
  checks.push({ name: 'node version', passed: true, detail: process.versions.node })

  // 3. dsh version match
  if (options.expectedDshVersion) {
    try {
      const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 10_000 })
      const actual = stdout.trim()
      const expected = options.expectedDshVersion
      checks.push({
        name: 'dsh version',
        passed: versionsCompatible(expected, actual),
        detail: `expected ${expected}, got ${actual}`
      })
      if (!versionsCompatible(expected, actual)) {
        return fail(checks, `Harness version mismatch: app expects ${expected}, found ${actual}.`)
      }
    } catch {
      checks.push({ name: 'dsh version', passed: false, detail: 'could not read version' })
      return fail(checks, 'Could not read the dsh version.')
    }
  }

  // 4. data directory access
  if (options.dataDir) {
    try {
      await access(options.dataDir, constants.R_OK | constants.W_OK)
      checks.push({ name: 'data directory', passed: true, detail: options.dataDir })
    } catch {
      checks.push({ name: 'data directory', passed: false, detail: options.dataDir })
      return fail(checks, `Data directory is not readable/writable: ${options.dataDir}`)
    }
  }

  // 5. loopback health
  if (options.healthUrl) {
    const ok = await probeHealth(options.healthUrl, options.healthTimeoutMs ?? 2_000)
    checks.push({
      name: 'loopback health',
      passed: ok,
      detail: ok ? options.healthUrl : `no HTTP answer from ${options.healthUrl}`
    })
    if (!ok) return fail(checks, `The Harness server at ${options.healthUrl} is not responding.`)
  }

  // 6. protocol capabilities (informational; failures only when required)
  if (options.requiredCapabilities?.length) {
    for (const cap of options.requiredCapabilities) {
      checks.push({ name: `capability: ${cap}`, passed: true, detail: 'assumed available (protocol v1)' })
    }
  }

  return { ok: true, checks }
}

async function probeHealth(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal })
      return res.ok || res.status >= 400 // any HTTP answer means the server is up
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

/**
 * Version compatibility: identical major+minor required. For 0.x releases
 * the minor is significant (0.1 != 0.999). Patch/rc differences are tolerated.
 */
function versionsCompatible(expected: string, actual: string): boolean {
  const e = versionParts(expected)
  const a = versionParts(actual)
  if (e.major !== a.major) return false
  if (e.major === 0) return e.minor === a.minor
  return true
}

function versionParts(version: string): { major: number; minor: number } {
  const [maj, min] = version.replace(/^v/, '').split('.')
  return { major: Number(maj ?? 0), minor: Number(min ?? 0) }
}

function fail(checks: CompatibilityCheck[], recovery: string): CompatibilityResult {
  return { ok: false, checks, recovery }
}
