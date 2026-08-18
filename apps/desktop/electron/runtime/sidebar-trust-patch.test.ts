/**
 * Unit tests for the better-sidebar remote-trust patch
 * (apps/desktop/electron/runtime/sidebar-trust-patch.ts).
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applySidebarTrustPatch,
  sidebarHostLib
} from './sidebar-trust-patch'

const ORIGINAL_TRUSTED_HOSTS_OF = `function trustedHostsOf(ctx) {
	for (const entry of ctx.loader.entries()) if (entry.options.name === "connection") return entry.options.config?.trustedHosts ?? [];
	return [];
}
`

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sidebar-patch-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function writeFakeLib(libDir: 'lib', source: string): string {
  const libPath = join(tmp, 'profiles', 'web', 'node_modules', 'dsh-better-sidebar', libDir)
  mkdirSync(libPath, { recursive: true })
  const index = join(libPath, 'index.js')
  writeFileSync(index, source, 'utf8')
  return index
}

describe('applySidebarTrustPatch', () => {
  it('patches the installed lib and replaces the trust source', () => {
    writeFakeLib('lib', ORIGINAL_TRUSTED_HOSTS_OF)
    const applied = applySidebarTrustPatch(tmp)
    expect(applied).toBe(true)

    const patched = readFileSync(sidebarHostLib(tmp), 'utf8')
    expect(patched).not.toContain('for (const entry of ctx.loader.entries()) if (entry.options.name === "connection") return entry.options.config?.trustedHosts ?? [];')
    expect(patched).toContain('/* desktop-sidebar-trust-patch */')
    expect(patched).toContain('ctx.get?.("connection")?.trustedHosts')
    expect(patched).toContain('process.env.DSH_TRUSTED_HOSTS')
  })

  it('is idempotent (second run leaves the patched source unchanged)', () => {
    writeFakeLib('lib', ORIGINAL_TRUSTED_HOSTS_OF)

    expect(applySidebarTrustPatch(tmp)).toBe(true)
    expect(applySidebarTrustPatch(tmp)).toBe(true)

    const after = readFileSync(sidebarHostLib(tmp), 'utf8')
    expect(after).toContain('/* desktop-sidebar-trust-patch */')
    // one marker, not two
    expect(after.split('/* desktop-sidebar-trust-patch */').length - 1).toBe(1)
  })

  it('returns false without crashing when the lib is missing', () => {
    expect(applySidebarTrustPatch(tmp)).toBe(false)
  })

  it('returns false when the lib shape changed (no exact needle)', () => {
    writeFakeLib('lib', 'function trustedHostsOf(ctx) {\n\treturn somethingElse;\n}\n')
    expect(applySidebarTrustPatch(tmp)).toBe(false)
  })
})