/** Task 2.1 — error classification (v2.1). */

export type ErrorCode =
  | 'rate_limit' // 429 / quota exhausted
  | 'timeout'
  | 'network'
  | 'auth' // invalid/expired API key
  | 'context_overflow'
  | 'cancelled'
  | 'unknown'

export interface ProtocolError {
  code: ErrorCode
  message: string
  /** Whether a simple retry is likely to help. */
  retryable: boolean
  /** User-facing recovery hint (short). */
  hint?: string
}

const RETRYABLE: ReadonlySet<ErrorCode> = new Set(['rate_limit', 'timeout', 'network'])

/** Normalize any error-ish input to a searchable string. */
function messageOf(input: unknown): string {
  if (input instanceof Error) return input.message
  if (typeof input === 'string') return input
  if (typeof input === 'object' && input !== null) {
    const o = input as { message?: unknown; error?: unknown }
    if (typeof o.message === 'string') return o.message
    if (typeof o.error === 'string') return o.error
  }
  return String(input)
}

export function classifyError(input: unknown): ProtocolError {
  const msg = messageOf(input).toLowerCase()
  if (/rate.?limit|429|quota/i.test(msg)) return mk('rate_limit', messageOf(input), 'Slow down or upgrade quota; retry later.')
  if (/timeout|timed out/i.test(msg)) return mk('timeout', messageOf(input), 'Retry; if persistent, check network or model latency.')
  if (/network|fetch failed|econnreset|enotfound|socket/i.test(msg)) return mk('network', messageOf(input), 'Check your connection and retry.')
  if (/auth|api[ _-]?key|401|403|unauthorized|invalid.*key/i.test(msg)) return mk('auth', messageOf(input), 'Re-enter a valid API key in Settings.')
  if (/context|token.*(limit|exceed|overflow)|too long/i.test(msg)) return mk('context_overflow', messageOf(input), 'Trim the conversation or start a new one.')
  if (/cancel/i.test(msg)) return mk('cancelled', messageOf(input))
  return mk('unknown', messageOf(input))
}

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE.has(code)
}

function mk(code: ErrorCode, message: string, hint?: string): ProtocolError {
  return { code, message, retryable: isRetryable(code), hint }
}
