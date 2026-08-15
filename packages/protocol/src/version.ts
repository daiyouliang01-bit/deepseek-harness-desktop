/** Task 2.1 — protocol version negotiation. */

/** Current protocol version implemented by this client. */
export const PROTOCOL_VERSION = 1

/** Minimum remote major version this client can talk to. */
export const MIN_COMPATIBLE_MAJOR = 1

export interface VersionInfo {
  major: number
  minor: number
}

export function parseVersion(raw: string | number): VersionInfo {
  if (typeof raw === 'number') return { major: raw, minor: 0 }
  const m = /^(\d+)(?:\.(\d+))?/.exec(raw)
  if (!m) throw new Error(`invalid protocol version: ${raw}`)
  return { major: Number(m[1]), minor: Number(m[2] ?? 0) }
}

/**
 * Two ends are compatible when their major versions match. Unknown future
 * events must be tolerated (see decodeEvent), so a remote with a NEWER minor
 * in the same major is fine; a different major requires a client upgrade.
 */
export function isCompatible(local: VersionInfo | string | number, remote: VersionInfo | string | number): boolean {
  const l = typeof local === 'object' ? local : parseVersion(local)
  const r = typeof remote === 'object' ? remote : parseVersion(remote)
  return l.major === r.major && r.major >= MIN_COMPATIBLE_MAJOR
}

/** Human-readable negotiation result. */
export function negotiate(local: VersionInfo | string | number, remote: VersionInfo | string | number): {
  ok: boolean
  reason?: string
  remote: VersionInfo
} {
  const l = typeof local === 'object' ? local : parseVersion(local)
  const r = typeof remote === 'object' ? remote : parseVersion(remote)
  if (r.major === l.major) return { ok: true, remote: r }
  return {
    ok: false,
    reason: `protocol major mismatch: client ${l.major}, runtime ${r.major}`,
    remote: r
  }
}
