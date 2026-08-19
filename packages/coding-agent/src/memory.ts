export const MEMORY_MAX_BYTES = 8192
/** Word-boundary secret scan: "gentoken" or "keyboard" must not trip it. */
const SECRET = /\b(?:api[_-]?key|secret|token|password|passwd|credential|bearer)\b/i

export function readMemory(text: string): string {
  const trimmed = text.trim()
  if (Buffer.byteLength(trimmed, 'utf8') <= MEMORY_MAX_BYTES) return trimmed
  let cut = trimmed
  while (Buffer.byteLength(cut, 'utf8') > MEMORY_MAX_BYTES) {
    cut = cut.slice(0, Math.max(0, cut.length - 16))
  }
  return cut
}

export function appendMemory(
  existing: string,
  entry: string,
): { ok: true; next: string } | { ok: false; reason: 'secret' | 'empty' | 'cap' } {
  const fact = entry.trim()
  if (!fact) return { ok: false, reason: 'empty' }
  if (SECRET.test(fact)) return { ok: false, reason: 'secret' }
  const base = existing.trim()
  const next = base ? `${base}\n${fact}` : fact
  if (Buffer.byteLength(next, 'utf8') > MEMORY_MAX_BYTES) return { ok: false, reason: 'cap' }
  return { ok: true, next }
}
