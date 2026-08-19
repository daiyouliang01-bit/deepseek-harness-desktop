/**
 * @dshd/dsh-installed — host half.
 *
 * Lists user-installed plugins and skills, and checks for updates on demand.
 * Marketplace / 1024 Store surfaces stay disabled in the web profile patch.
 */
import { mountRoutes } from './routes.js'

function argvProfile() {
  const index = process.argv.indexOf('--profile')
  const candidate = index >= 0 ? process.argv[index + 1] : undefined
  return candidate !== undefined && !candidate.startsWith('-') ? candidate : undefined
}

export const name = 'dsh-installed'

/**
 * @param {any} ctx
 * @param {{ profile?: string }} [config]
 */
export function apply(ctx, config = {}) {
  const profile = config.profile ?? argvProfile() ?? 'web'
  ctx.inject(['webServer'], (hostContext) => {
    hostContext.effect(
      () => mountRoutes(hostContext.webServer, { profile }),
      'dsh-installed: http routes',
    )
  })
}

export default { name, apply }
