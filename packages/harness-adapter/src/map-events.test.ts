import { createCodingAgent } from '@dshd/coding-agent'
import { describe, expect, it } from 'vitest'
import { PROCESS_PLUGIN_ID, mapCodingAgentToDesktopEvents } from './index'

describe('harness-adapter scaffold', () => {
  it('reserves the process plugin id without patching official rows', () => {
    expect(PROCESS_PLUGIN_ID).toBe('coding-agent')
  })

  it('emits no desktop events from an idle scaffold agent', () => {
    expect(mapCodingAgentToDesktopEvents(createCodingAgent())).toEqual([])
  })

  it('emits task-updated and verify-finished from live state', () => {
    expect(
      mapCodingAgentToDesktopEvents({
        phase: 'working',
        lastVerify: [{ kind: 'test', ok: false }],
      }),
    ).toEqual([
      { type: 'task-updated', phase: 'working' },
      { type: 'verify-finished', ok: false },
    ])
  })
})
