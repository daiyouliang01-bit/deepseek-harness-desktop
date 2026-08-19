/** Task 3.2 — normalized Agent event reducer (pure, order-preserving). */

import type { AgentEvent } from '@dshd/protocol'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** true while deltas are still arriving */
  streaming: boolean
  /** tool calls attached to this assistant turn */
  toolCalls: ToolCallState[]
  /** errors attached to this turn */
  errors: ChatError[]
  /** image attachment references (M3) */
  images?: Array<{ attachmentId: string; name?: string; width?: number; height?: number }>
  ts: number
}

export interface ToolCallState {
  callId: string
  name: string
  args: unknown
  status: 'running' | 'ok' | 'failed'
  output?: unknown
}

export interface ChatError {
  code: string
  message: string
  retryable: boolean
  hint?: string
}

export interface ChatState {
  /** ordered conversation messages */
  messages: ChatMessage[]
  /** last run completion metadata (by run id) */
  completions: Record<string, { usage?: { tokens: number } }>
  /** pending approvals awaiting user decision */
  approvals: Array<{ id: string; permission: string; scope?: unknown; callId?: string }>
  /** pending interactive questions awaiting user answer */
  questions: Array<{ id: string; question: string; options?: Array<{ label: string; value: unknown }>; multiSelect?: boolean }>
  /** last coding-agent task phase, if any */
  taskPhase?: 'idle' | 'planning' | 'working' | 'verifying' | 'completed' | 'failed'
  /** last verify outcome */
  verifyOk?: boolean
}

export const initialState: ChatState = { messages: [], completions: {}, approvals: [], questions: [] }

function lastMessage(state: ChatState): ChatMessage | undefined {
  return state.messages[state.messages.length - 1]
}

/**
 * Return the state with a streaming assistant turn guaranteed as the last
 * message. Reuses the last message when it is already a streaming assistant
 * turn (events of one run carry distinct ids — delta/tool/completion — so the
 * turn is keyed by position, not by id). Creates a new turn otherwise.
 */
function ensureAssistantTurn(state: ChatState, eventId: string): ChatState {
  const last = lastMessage(state)
  if (last && last.role === 'assistant') return state
  return {
    ...state,
    messages: [
      ...state.messages,
      { id: eventId, role: 'assistant', content: '', streaming: true, toolCalls: [], errors: [], ts: Date.now() }
    ]
  }
}

/** Apply one event to the state. Pure: never mutates. */
export function reduceEvent(state: ChatState, event: AgentEvent): ChatState {
  switch (event.type) {
    case 'unknown':
      return state // tolerate future event types (protocol v1 rule)

    case 'message': {
      if (event.role === 'user') {
        return {
          ...state,
          messages: [
            ...state.messages,
            { id: event.id, role: 'user', content: event.content, streaming: false, toolCalls: [], errors: [], images: event.images, ts: event.ts }
          ]
        }
      }
      // assistant message event: record content and finalize any open turn
      const next = ensureAssistantTurn(state, event.id)
      const last = lastMessage(next)
      if (!last || last.role !== 'assistant') return state
      const updated = { ...last, content: event.content, streaming: false }
      return { ...next, messages: [...next.messages.slice(0, -1), updated] }
    }

    case 'delta': {
      const next = ensureAssistantTurn(state, event.id)
      const last = lastMessage(next)
      if (!last || last.role !== 'assistant') return state
      const updated = { ...last, content: last.content + event.text }
      return { ...next, messages: [...next.messages.slice(0, -1), updated] }
    }

    case 'reasoning': {
      const next = ensureAssistantTurn(state, event.id)
      const last = lastMessage(next)
      if (!last || last.role !== 'assistant') return state
      const updated = { ...last, content: last.content + event.text }
      return { ...next, messages: [...next.messages.slice(0, -1), updated] }
    }

    case 'tool-call': {
      const next = ensureAssistantTurn(state, event.id)
      const last = lastMessage(next)
      if (!last || last.role !== 'assistant') return state
      const updated: ChatMessage = {
        ...last,
        toolCalls: [
          ...last.toolCalls,
          { callId: event.callId, name: event.name, args: event.args, status: 'running' }
        ]
      }
      return { ...next, messages: [...next.messages.slice(0, -1), updated] }
    }

    case 'tool-result': {
      const next = ensureAssistantTurn(state, event.id)
      const last = lastMessage(next)
      if (!last || last.role !== 'assistant') return state
      const toolCalls = last.toolCalls.map((tc) =>
        tc.callId === event.callId ? { ...tc, status: event.ok ? ('ok' as const) : ('failed' as const), output: event.output } : tc
      )
      const updated = { ...last, toolCalls }
      return { ...next, messages: [...next.messages.slice(0, -1), updated] }
    }

    case 'approval-request': {
      return {
        ...state,
        approvals: [...state.approvals, { id: event.id, permission: event.permission, scope: event.scope, callId: event.callId }]
      }
    }

    case 'question': {
      // Interactive question surfaced to the user; rendered by the chat UI
      // (answer via the adapter's respond path in M4).
      return {
        ...state,
        questions: [...state.questions, { id: event.id, question: event.question, options: event.options, multiSelect: event.multiSelect }]
      }
    }

    case 'approval-resolved': {
      return { ...state, approvals: state.approvals.filter((a) => a.id !== event.id) }
    }

    case 'question-resolved': {
      return { ...state, questions: state.questions.filter((q) => q.id !== event.id) }
    }

    case 'error': {
      const err: ChatError = { code: event.code, message: event.message, retryable: event.retryable, hint: event.hint }
      const last = lastMessage(state)
      if (last && last.role === 'assistant') {
        const updated = { ...last, errors: [...last.errors, err], streaming: false }
        return { ...state, messages: [...state.messages.slice(0, -1), updated] }
      }
      // error outside a turn: attach to a synthetic assistant message
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.id, role: 'assistant', content: '', streaming: false, toolCalls: [], errors: [err], ts: Date.now() }
        ]
      }
    }

    case 'task-updated':
      return { ...state, taskPhase: event.phase }

    case 'verify-finished':
      return { ...state, verifyOk: event.ok }

    case 'completion': {
      const next = ensureAssistantTurn(state, event.id)
      const last = lastMessage(next)
      const messages =
        last && last.role === 'assistant'
          ? [...next.messages.slice(0, -1), { ...last, streaming: false }]
          : next.messages
      return {
        ...next,
        messages,
        completions: { ...next.completions, [event.id]: { usage: event.usage } }
      }
    }
  }
}

/** Apply a batch of events (e.g. fixture replay or reconnect recovery). */
export function reduceEvents(state: ChatState, events: AgentEvent[]): ChatState {
  return events.reduce(reduceEvent, state)
}

/** Resolve an approval decision. */
export function resolveApproval(state: ChatState, approvalId: string): ChatState {
  return { ...state, approvals: state.approvals.filter((a) => a.id !== approvalId) }
}

/** Resolve an answered question. */
export function resolveQuestion(state: ChatState, questionId: string): ChatState {
  return { ...state, questions: state.questions.filter((q) => q.id !== questionId) }
}
