/**
 * @dshd/coding-agent-host — host half.
 *
 * Folds project context into the first pre-step after next().
 * After write/edit, verifies existing npm scripts and may steer one fix.
 * Publishes no service, so it does not need an isolate realm.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { interpretCommandResult, prepareProjectContextMessage, SessionLoop } from './process-bridge.js'

const alreadyInjected = new Set()
const loop = new SessionLoop()

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function listDir(path) {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

function sessionOf(agentOrSession) {
  const session = agentOrSession?.session ?? agentOrSession
  const cwd = session?.header?.cwd ?? session?.cwd
  const sessionId = agentOrSession?.id ?? session?.header?.id ?? session?.id
  return { session, cwd, sessionId }
}

export default {
  name: 'coding-agent',
  inject: ['tools', 'agents'],
  apply(ctx) {
    if (!ctx || typeof ctx.on !== 'function') return
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      try {
        if (!decision || decision.kind !== 'enter') return decision
        const { cwd, sessionId } = sessionOf(payload?.agent)
        if (!sessionId) return decision
        loop.noteUserTurn(sessionId)
        const extra = await Promise.race([
          prepareProjectContextMessage({ sessionId, cwd, alreadyInjected }, { readText, listDir }),
          new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
        ])
        if (!extra) return decision
        // Mark AFTER the content is in hand: a timed-out snapshot must be
        // retried on the next pre-step, never silently skipped.
        if (extra.key) alreadyInjected.add(extra.key)
        const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
        const message = createUserMessage({
          content: [{ type: 'text', text: extra.content }],
          source: { kind: 'plugin', plugin: 'coding-agent' },
        })
        return { kind: 'enter', messages: [...decision.messages, message] }
      } catch {
        return decision
      }
    })
    ctx.on('tools/result', (exec) => {
      try {
        const { sessionId } = sessionOf(exec?.agent)
        if (sessionId && exec?.name) loop.noteMutation(sessionId, exec.name)
      } catch {
        /* never throw */
      }
    })
    ctx.on('session/event', (session, event) => {
      try {
        const type = event?.type
        const name = event?.data?.name
        const { sessionId } = sessionOf(session)
        if (sessionId && type === 'tool/call' && typeof name === 'string') {
          loop.noteMutation(sessionId, name)
        }
      } catch {
        /* never throw */
      }
      void onTurnEnd(ctx, session, event)
    })
    ctx.on('session/disposed', (session) => {
      try {
        const { sessionId } = sessionOf(session)
        if (sessionId) loop.dispose(sessionId)
      } catch {
        /* never throw */
      }
    })
    ctx.on('turn/end', (payload) => {
      const session = payload?.session ?? payload?.agent?.session
      void onTurnEnd(ctx, session, { type: 'turn/end' })
    })
  },
}

async function onTurnEnd(ctx, session, event) {
  try {
    const type = event?.type ?? event?.event?.type
    if (type !== 'turn/end') return
    const { cwd, sessionId } = sessionOf(session)
    if (!sessionId) return
    const tools = ctx.tools
    const action = await loop.finishTurn(sessionId, cwd, {
      readText,
      writeFile(path, data) {
        writeFileSync(path, data, 'utf8')
      },
      mkdirp(path) {
        mkdirSync(path, { recursive: true })
      },
      rename(from, to) {
        const { renameSync } = require('node:fs')
        renameSync(from, to)
      },
      async runCommand(cmd) {
        if (!tools || typeof tools.execute !== 'function') {
          throw new Error('bash tool unavailable')
        }
        const result = await tools.execute({
          callId: `coding-agent-verify-${Date.now()}`,
          name: 'bash',
          arguments: {
            command: cmd,
            description: 'Run project verify script',
            workdir: cwd,
            timeoutMs: 60_000,
          },
          signal: AbortSignal.timeout(60_000),
        })
        return interpretCommandResult(result)
      },
    })
    if (action.type !== 'steer') return
    const agent = ctx.agents.get(sessionId)
    if (!agent || typeof agent.steer !== 'function') return
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
    agent.steer(
      createUserMessage({
        content: [{ type: 'text', text: action.content }],
        source: { kind: 'plugin', plugin: 'coding-agent' },
      }),
    )
  } catch (error) {
    try {
      const cwd = sessionOf(session).cwd
      if (cwd) {
        mkdirSync(join(cwd, '.dsh'), { recursive: true })
        writeFileSync(join(cwd, '.dsh', 'loop-error.txt'), String(error && error.stack ? error.stack : error))
      }
    } catch {
      /* ignore */
    }
  }
}
