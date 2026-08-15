/** Task 2.1 — commands the UI sends to the runtime. */

export type ProtocolCommand =
  | { type: 'send-message'; conversationId: string; content: string }
  | { type: 'cancel'; runId: string }
  | { type: 'retry'; runId: string }
  | { type: 'approve'; approvalId: string; allowed: boolean }
  | { type: 'ping' }

export function encodeCommand(command: ProtocolCommand): string {
  return JSON.stringify(command)
}

export function decodeCommand(raw: string): ProtocolCommand {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('command must be an object')
  const obj = parsed as Record<string, unknown>
  if (typeof obj.type !== 'string') throw new Error('command missing `type`')
  switch (obj.type) {
    case 'send-message':
      if (typeof obj.conversationId !== 'string' || typeof obj.content !== 'string') {
        throw new Error('send-message requires conversationId and content strings')
      }
      return { type: 'send-message', conversationId: obj.conversationId, content: obj.content }
    case 'cancel':
    case 'retry':
      if (typeof obj.runId !== 'string') throw new Error(`${obj.type} requires runId`)
      return { type: obj.type, runId: obj.runId }
    case 'approve':
      if (typeof obj.approvalId !== 'string' || typeof obj.allowed !== 'boolean') {
        throw new Error('approve requires approvalId and allowed')
      }
      return { type: 'approve', approvalId: obj.approvalId, allowed: obj.allowed }
    case 'ping':
      return { type: 'ping' }
    default:
      throw new Error(`unknown command type '${obj.type}'`)
  }
}
