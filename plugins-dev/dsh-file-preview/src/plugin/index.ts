// src/plugin/index.ts
import { Context } from '@deepseek-ai/cordis'
import { createRpcHandler } from './rpc.ts'
import { previewHandler } from './preview-route.ts'

export const inject: string[] = ['webServer']

export function apply(ctx: Context): void {
  const cwd = process.cwd()
  const webServer = ctx.get('webServer') as { register(route: unknown): unknown } | undefined
  if (!webServer) return
  webServer.register({ kind: 'prefix', path: '/preview/', handler: previewHandler })
  webServer.register({ kind: 'exact', path: '/preview/api', handler: createRpcHandler(cwd) })
}
