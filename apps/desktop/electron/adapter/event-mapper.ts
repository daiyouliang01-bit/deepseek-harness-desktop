/**
 * M1 — event mapper: Harness SessionEvent / mux frames → @dshd/protocol.
 *
 * The renderer only ever sees protocol events. Unknown/ignorable events map to
 * 'unknown' (tolerated) instead of failing the stream.
 */

import type { AgentEvent } from '@dshd/protocol'
import { classifyError } from '@dshd/protocol'
import type {
  ApprovalRequestedFrame,
  QuestionRequestedFrame,
  SessionEventFrame,
  SessionSubscribedFrame
} from './wire-types'

export interface MappedBatch {
  events: AgentEvent[]
  /** rpcIds of answerable server-requests seen in this batch */
  pendingRequests: Array<{ rpcId: string; kind: 'approval' | 'question'; approvalId?: string; questionRpcId?: string }>
}

export function mapSessionEvent(frame: SessionEventFrame): AgentEvent | null {
  const { event } = frame
  switch (event.type) {
    case 'user/message': {
      const content = extractText(event.data)
      const images = extractImages(event.data)
      return {
        type: 'message',
        id: `${frame.sessionId}:${event.seq}`,
        role: 'user',
        content,
        ts: event.time,
        images: images.length > 0 ? images : undefined
      }
    }
    case 'assistant/chunk': {
      const chunk = event.data.chunk as { delta?: string; text?: string } | undefined
      return {
        type: 'delta',
        id: `${frame.sessionId}:${event.seq}`,
        seq: event.seq,
        text: chunk?.delta ?? chunk?.text ?? ''
      }
    }
    case 'assistant/message': {
      return {
        type: 'message',
        id: `${frame.sessionId}:${event.seq}`,
        role: 'assistant',
        content: extractText(event.data),
        ts: event.time
      }
    }
    case 'tool/call': {
      const data = event.data as { callId?: string; name?: string; args?: unknown }
      return {
        type: 'tool-call',
        id: `${frame.sessionId}:${event.seq}`,
        callId: String(data.callId ?? event.seq),
        name: String(data.name ?? 'tool'),
        args: data.args
      }
    }
    case 'tool/result': {
      const data = event.data as { callId?: string; ok?: boolean; output?: unknown; error?: unknown }
      return {
        type: 'tool-result',
        id: `${frame.sessionId}:${event.seq}`,
        callId: String(data.callId ?? event.seq),
        ok: data.ok !== false && data.error === undefined,
        output: data.output ?? data.error ?? null
      }
    }
    case 'turn/end':
      return { type: 'completion', id: `${frame.sessionId}:${event.seq}` }
    case 'error': {
      const raw = (event.data as { error?: unknown; message?: unknown }).error ?? event.data.message
      const err = classifyError(raw)
      return {
        type: 'error',
        id: `${frame.sessionId}:${event.seq}`,
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        hint: err.hint
      }
    }
    default:
      // ignorable or unknown → tolerated; required-but-unknown events are the
      // consumer's concern (logged by the connection layer).
      return null
  }
}

/**
 * Extract image attachment references from a message event's content blocks
 * (M3): `{type:'image', attachment: {attachmentId, name?, width?, height?}}`.
 */
function extractImages(data: Record<string, unknown>): Array<{ attachmentId: string; name?: string; width?: number; height?: number }> {
  const content = data.content
  if (!Array.isArray(content)) return []
  const out: Array<{ attachmentId: string; name?: string; width?: number; height?: number }> = []
  for (const part of content) {
    if (part && typeof part === 'object') {
      const p = part as { type?: string; attachment?: { attachmentId?: unknown; name?: unknown; width?: unknown; height?: unknown } }
      if (p.type === 'image' && p.attachment && typeof p.attachment.attachmentId === 'string') {
        out.push({
          attachmentId: p.attachment.attachmentId,
          name: typeof p.attachment.name === 'string' ? p.attachment.name : undefined,
          width: typeof p.attachment.width === 'number' ? p.attachment.width : undefined,
          height: typeof p.attachment.height === 'number' ? p.attachment.height : undefined
        })
      }
    }
  }
  return out
}

/** Extract displayable text from a message event's data (best effort). */
function extractText(data: Record<string, unknown>): string {
  const content = data.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const p = part as { text?: unknown; content?: unknown; type?: string }
          if (typeof p.text === 'string') return p.text
          if (typeof p.content === 'string') return p.content
          return `[${p.type ?? 'part'}]`
        }
        return ''
      })
      .join('')
  }
  return ''
}

/**
 * Map a mux control frame to protocol events + pending-request bookkeeping.
 * Returns null when the frame needs no renderer-visible event.
 */
export function mapControlFrame(
  frame: SessionSubscribedFrame | ApprovalRequestedFrame | QuestionRequestedFrame,
  rpcId: string
): { events: AgentEvent[]; pending: MappedBatch['pendingRequests'] } {
  switch (frame.type) {
    case 'session/subscribed':
      return { events: [], pending: [] } // baseline handled by the connection layer
    case 'approval/requested':
      return {
        events: [
          {
            type: 'approval-request',
            id: frame.approvalId,
            permission: `tool:${frame.toolName}`,
            scope: { callId: frame.callId, reason: frame.reason }
          }
        ],
        pending: [{ rpcId, kind: 'approval', approvalId: frame.approvalId }]
      }
    case 'question/requested': {
      const first = frame.questions[0]
      return {
        events: [
          {
            type: 'question',
            id: first?.rpcId ?? 'q',
            question: first?.question ?? 'Question',
            options: first?.options,
            multiSelect: first?.multiSelect
          }
        ],
        pending: [{ rpcId, kind: 'question', questionRpcId: first?.rpcId }]
      }
    }
  }
}
