/**
 * M1 — wire contract types for the Harness web transport (HTTP-up / SSE-down).
 *
 * Mirrors the official wire shapes (dsh-client-connection / dsh-host-apiproxy
 * .d.ts) for the subset the desktop adapter needs. Everything is
 * JSON-serializable; nothing here imports Harness internals.
 */

// --- RPC envelope ---

export interface ClientRequest<P = unknown> {
  type: 'client-request'
  rpcId: string
  method: string
  payload: P
}

export interface ServerResponse<V = unknown> {
  type: 'server-response'
  rpcId: string
  result:
    | { ok: true; value: V }
    | { ok: false; error: { code: string; message: string; details?: unknown } }
}

export interface ServerRequest<F = unknown> {
  type: 'server-request'
  rpcId: string
  method: string
  payload: F
}

export interface ClientResponse {
  type: 'client-response'
  rpcId: string
  result: { ok: true; value?: unknown } | { ok: false; error: { code: string; message: string } }
}

// --- Mux frames (payload of server-request frames on /api/events.mux) ---

export interface SessionEventFrame {
  type: 'session/event'
  sessionId: string
  event: SessionEvent
  view?: ToolEventView
}

export interface SessionSubscribedFrame {
  type: 'session/subscribed'
  sessionId: string
  lastSeq: number
}

export interface ApprovalRequestedFrame {
  type: 'approval/requested'
  sessionId: string
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
}

export interface ApprovalResolvedFrame {
  type: 'approval/resolved'
  sessionId: string
  approvalId: string
  outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
}

export interface QuestionRequestedFrame {
  type: 'question/requested'
  sessionId: string
  questions: AskUserQuestionItem[]
}

export interface QuestionResolvedFrame {
  type: 'question/resolved'
  sessionId: string
  questionRpcId: string
  outcome: 'answered' | 'cancelled'
}

export interface SessionQueueFrame {
  type: 'session/queue'
  sessionId: string
  items: Array<{ id: string; placement: 'queued' | 'steering' | 'context'; message: unknown }>
}

export interface SessionProjectionFrame {
  type: 'session/projection'
  sessionId: string
  key: string
  value: unknown
  seq: number
}

export interface StreamErrorFrame {
  type: 'stream/error'
  error: { code: string; message: string }
}

export interface AskUserQuestionItem {
  rpcId?: string
  question: string
  options?: Array<{ label: string; value: unknown }>
  multiSelect?: boolean
}

export type MuxFrame =
  | SessionEventFrame
  | SessionSubscribedFrame
  | ApprovalRequestedFrame
  | ApprovalResolvedFrame
  | QuestionRequestedFrame
  | QuestionResolvedFrame
  | SessionQueueFrame
  | SessionProjectionFrame
  | StreamErrorFrame

// --- SessionEvent (subset used by the adapter; unknown types tolerated) ---

export interface SessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  ignorable?: true
  surfaceOp?: unknown
}

// --- Tool render intent ---

export interface ToolEventView {
  for: 'call' | 'result'
  view: Record<string, unknown>
}
