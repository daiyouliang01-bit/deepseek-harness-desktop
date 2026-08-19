import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CODING_AGENT_ID, createCodingAgent } from './index'

describe('createCodingAgent', () => {
  it('returns idle stubs for every first-phase module', () => {
    const agent = createCodingAgent()
    expect(agent.id).toBe(CODING_AGENT_ID)
    expect(agent.id).toBe('coding-agent')
    expect(agent.version).toBe('0.1.0')
    expect(agent.taskEngine.phase()).toBe('idle')
    expect(agent.verifier.lastResult()).toBeNull()
    expect(agent.memory.read()).toBe('')
    expect(agent.hooks.run('afterEdit', {})).toBeUndefined()
  })

  it('does not import official Harness packages', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')
    expect(src).not.toMatch(/@deepseek-ai\//)
  })
})
