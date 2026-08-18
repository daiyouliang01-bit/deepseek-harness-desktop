/**
 * Task 7.x — better-sidebar remote-trust patch.
 *
 * dsh-better-sidebar (installed in the web profile's node_modules) renders
 * /sidebar/* (explorer, editor, git, terminals) with its OWN copy of the
 * browser-trust fence. Its `trustedHostsOf(ctx)` only reads the Loader row's
 * RAW config, which does not expose the CLI-injected authorities
 * (`--trusted-host dsh.dpharness.xyz`), so every /sidebar request from a
 * remote origin is 403 even though the /api gateway accepts it.
 *
 * This module re-applies a tiny, idempotent monkey-patch to the installed
 * lib before every runtime start: `trustedHostsOf` first reads the LIVE
 * `connection` service's resolved trust list (the exact list the /api fence
 * runs with), then falls back to the loader row, then to the desktop-app
 * env `DSH_TRUSTED_HOSTS`. Never fatal — on any failure the fence keeps its
 * current (loopback-only) behavior.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Installed better-sidebar host lib under the web profile. */
export function sidebarHostLib(dshHome: string): string {
  return join(dshHome, 'profiles', 'web', 'node_modules', 'dsh-better-sidebar', 'lib', 'index.js')
}

const MARKER = '/* desktop-sidebar-trust-patch */'

const PATCHED_SOURCE = `function trustedHostsOf(ctx) {
	${MARKER}
	const live = ctx.get?.("connection")?.trustedHosts;
	if (live !== void 0 && live !== null && Array.isArray(live) && live.length > 0) return live;
	const fromEnv = (process.env.DSH_TRUSTED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
	for (const entry of ctx.loader.entries()) if (entry.options.name === "connection") {
		const fromRow = entry.options.config?.trustedHosts;
		return [...(Array.isArray(fromRow) ? fromRow : []), ...fromEnv];
	}
	return fromEnv;
}
`

/**
 * Apply the trust-source patch to the installed better-sidebar lib.
 * Returns true when the patched form is in place (already patched or just
 * patched). Returns false when the lib is missing or the patch cannot be
 * applied cleanly (app continues; /sidebar stays loopback-only).
 */
export function applySidebarTrustPatch(dshHome: string): boolean {
  const libPath = sidebarHostLib(dshHome)
  try {
    if (!existsSync(libPath)) return false
    let source = readFileSync(libPath, 'utf8')

    const NEEDLE = `function trustedHostsOf(ctx) {
	for (const entry of ctx.loader.entries()) if (entry.options.name === "connection") return entry.options.config?.trustedHosts ?? [];
	return [];
}`

    if (source.includes('/* desktop-sidebar-trust-patch */')) {
      return true // already patched
    }

    const fresh = source.includes(NEEDLE)
    if (!fresh) return false // lib shape changed; do not force

    source = source.replace(NEEDLE, PATCHED_SOURCE)
    writeFileSync(libPath, source, 'utf8')
    return true
  } catch {
    return false
  }
}