/** Task 4.1 — approval workflow: one-time, session, workspace-scoped, expiry. */

import type { PermissionRequest } from './policy'

export type ApprovalMode = 'one-time' | 'session' | 'workspace'

export interface ApprovalState {
  /** pending requests awaiting a decision */
  pending: Map<string, PermissionRequest>
  /** active grants: key = `${klass}:${scope ?? '*'}` */
  grants: Map<string, Grant>
}

export interface Grant {
  requestId: string
  klass: PermissionRequest['klass']
  scope?: string
  mode: ApprovalMode
  grantedAt: number
  /** session grants expire with the session end; explicit TTL supported */
  expiresAt?: number
}

export const WORKSPACE_SCOPE = '*'

export class ApprovalManager {
  private state: ApprovalState = { pending: new Map(), grants: new Map() }

  constructor(private readonly now: () => number = Date.now) {}

  /** Register a request for user approval. Returns the request id. */
  request(req: PermissionRequest): string {
    this.state.pending.set(req.id, req)
    return req.id
  }

  listPending(): PermissionRequest[] {
    return [...this.state.pending.values()]
  }

  /** Approve a request. `mode` controls how long the grant lasts. */
  approve(requestId: string, mode: ApprovalMode, ttlMs?: number): void {
    const req = this.state.pending.get(requestId)
    if (!req) return
    this.state.pending.delete(requestId)
    const scope = mode === 'workspace' ? WORKSPACE_SCOPE : req.scope
    const key = grantKey(req.klass, scope)
    this.state.grants.set(key, {
      requestId,
      klass: req.klass,
      scope,
      mode,
      grantedAt: this.now(),
      expiresAt: ttlMs ? this.now() + ttlMs : undefined
    })
  }

  deny(requestId: string): void {
    this.state.pending.delete(requestId)
  }

  /** Check whether an action is currently granted (and not expired). */
  isGranted(klass: PermissionRequest['klass'], scope?: string): boolean {
    this.expireStale()
    // exact scope grant, then workspace grant
    return this.state.grants.has(grantKey(klass, scope)) || this.state.grants.has(grantKey(klass, WORKSPACE_SCOPE))
  }

  revoke(klass: PermissionRequest['klass'], scope?: string): void {
    this.state.grants.delete(grantKey(klass, scope))
    this.state.grants.delete(grantKey(klass, WORKSPACE_SCOPE))
  }

  /** End of session: clear all grants (and pending). */
  endSession(): void {
    this.state.grants.clear()
  }

  private expireStale(): void {
    const now = this.now()
    for (const [key, grant] of this.state.grants) {
      if (grant.expiresAt !== undefined && grant.expiresAt <= now) this.state.grants.delete(key)
    }
  }
}

function grantKey(klass: string, scope?: string): string {
  return `${klass}:${scope ?? '*'}`.replace(/\/+/g, '/')
}
