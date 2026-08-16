/** Task 2.1 — stable application-level agent events. */

import type { ErrorCode } from './errors'

/**
 * Discriminated union of events the Agent UI consumes. These are the ONLY
 * event shapes the renderer may depend on — never Harness internals.
 * Unknown event types (added by future protocol minors) must be tolerated:
 * decodeEvent() wraps them as UnknownEvent instead of failing.
 */

export interface MessageEvent {
  type: 'message'
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

export interface DeltaEvent {
  type: 'delta'
  id: string
  /** monotonically increasing within a run */
  seq: number
  text: string
}

export interface ReasoningEvent {
  type: 'reasoning'
  id: string
  seq: number
  text: string
}

export interface ToolCallEvent {
  type: 'tool-call'
  id: string
  callId: string
  name: string
  args: unknown
}

export interface ToolResultEvent {
  type: 'tool-result'
  id: string
  callId: string
  ok: boolean
  output: unknown
}

export interface ApprovalRequestEvent {
  type: 'approval-request'
  id: string
  callId?: string
  permission: string
  scope?: unknown
}

export interface ErrorEvent {
  type: 'error'
  id: string
  code: ErrorCode
  message: string
  retryable: boolean
  hint?: string
}

export interface CompletionEvent {
  type: 'completion'
  id: string
  usage?: { tokens: number }
}

/** Interactive question surfaced to the user (Harness question/requested). */
export interface QuestionEvent {
  type: 'question'
  id: string
  question: string
  options?: Array<{ label: string; value: unknown }>
  multiSelect?: boolean
}

/** An approval was resolved (allowed/rejected/cancelled) — clear the pending card. */
export interface ApprovalResolvedEvent {
  type: 'approval-resolved'
  id: string
  outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
}

/** A question was answered/cancelled — clear the pending card. */
export interface QuestionResolvedEvent {
  type: 'question-resolved'
  id: string
  outcome: 'answered' | 'cancelled'
}

export interface UnknownEvent {
  type: 'unknown'
  rawType: string
  payload: unknown
}

export type AgentEvent =
  | MessageEvent
  | DeltaEvent
  | ReasoningEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | ErrorEvent
  | CompletionEvent
  | QuestionEvent
  | ApprovalResolvedEvent
  | QuestionResolvedEvent
  | UnknownEvent

const KNOWN_TYPES = new Set([
  'message',
  'delta',
  'reasoning',
  'tool-call',
  'tool-result',
  'approval-request',
  'error',
  'completion',
  'question',
  'approval-resolved',
  'question-resolved'
])

export type DecodeResult =
  | { ok: true; event: AgentEvent }
  | { ok: false; reason: string }

/**
 * Decode a single event line. Rules:
 * - malformed JSON / missing `type` / non-object → rejected
 * - unknown `type` → tolerated (wrapped as UnknownEvent) so future protocol
 *   minors never crash the UI
 */
export function decodeEvent(raw: string): DecodeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'malformed json' }
  }
  return decodeEventObject(parsed)
}

export function decodeEventObject(parsed: unknown): DecodeResult {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'event must be a JSON object' }
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.type !== 'string' || obj.type.length === 0) {
    return { ok: false, reason: 'event missing string `type`' }
  }
  if (!KNOWN_TYPES.has(obj.type)) {
    return { ok: true, event: { type: 'unknown', rawType: obj.type, payload: obj } }
  }
  // minimal structural validation for known types
  const id = obj.id
  if (typeof id !== 'string') return { ok: false, reason: `event '${obj.type}' missing string id` }
  switch (obj.type) {
    case 'message':
      return requireFields(obj, ['role', 'content'], (o) => ({
        type: 'message' as const,
        id,
        role: o.role as 'user' | 'assistant',
        content: String(o.content),
        ts: typeof o.ts === 'number' ? o.ts : Date.now()
      }))
    case 'delta':
    case 'reasoning':
      return requireFields(obj, ['seq', 'text'], (o) => ({
        type: obj.type as 'delta' | 'reasoning',
        id,
        seq: Number(o.seq),
        text: String(o.text)
      }))
    case 'tool-call':
      return requireFields(obj, ['callId', 'name'], (o) => ({
        type: 'tool-call' as const,
        id,
        callId: String(o.callId),
        name: String(o.name),
        args: o.args
      }))
    case 'tool-result':
      return requireFields(obj, ['callId', 'ok'], (o) => ({
        type: 'tool-result' as const,
        id,
        callId: String(o.callId),
        ok: Boolean(o.ok),
        output: o.output
      }))
    case 'approval-request':
      return requireFields(obj, ['permission'], (o) => ({
        type: 'approval-request' as const,
        id,
        callId: typeof o.callId === 'string' ? o.callId : undefined,
        permission: String(o.permission),
        scope: o.scope
      }))
    case 'error':
      return requireFields(obj, ['message'], (o) => ({
        type: 'error' as const,
        id,
        code: (o.code as ErrorCode) ?? 'unknown',
        message: String(o.message),
        retryable: Boolean(o.retryable),
        hint: typeof o.hint === 'string' ? o.hint : undefined
      }))
    case 'completion':
      return {
        ok: true,
        event: {
          type: 'completion',
          id,
          usage: typeof obj.usage === 'object' && obj.usage !== null ? (obj.usage as { tokens: number }) : undefined
        }
      }
    case 'question':
      return requireFields(obj, ['question'], (o) => ({
        type: 'question' as const,
        id,
        question: String(o.question),
        options: Array.isArray(o.options) ? (o.options as Array<{ label: string; value: unknown }>) : undefined,
        multiSelect: typeof o.multiSelect === 'boolean' ? o.multiSelect : undefined
      }))
    case 'approval-resolved':
      return requireFields(obj, ['outcome'], (o) => ({
        type: 'approval-resolved' as const,
        id,
        outcome: String(o.outcome) as 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
      }))
    case 'question-resolved':
      return requireFields(obj, ['outcome'], (o) => ({
        type: 'question-resolved' as const,
        id,
        outcome: String(o.outcome) as 'answered' | 'cancelled'
      }))
    default:
      return { ok: false, reason: `unhandled known type '${obj.type}'` }
  }
}

function requireFields<T>(
  obj: Record<string, unknown>,
  fields: string[],
  build: (o: Record<string, unknown>) => T
): DecodeResult {
  for (const f of fields) {
    if (obj[f] === undefined) return { ok: false, reason: `event '${obj.type}' missing '${f}'` }
  }
  return { ok: true, event: build(obj) as unknown as AgentEvent }
}
