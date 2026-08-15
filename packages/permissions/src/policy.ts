/** Task 4.1 — permission classes and decision policy. */

export type PermissionClass =
  | 'read' // read files, list dirs, read settings
  | 'edit' // write files within the workspace
  | 'execute' // shell commands / terminal
  | 'network' // external network requests
  | 'external-mcp' // external MCP tool servers

export type Decision = 'allow' | 'deny' | 'ask'

export interface PermissionRequest {
  id: string
  action: string
  klass: PermissionClass
  /** workspace-relative scope when applicable, e.g. 'src/main.ts' */
  scope?: string
  detail?: unknown
}

export interface PolicyRule {
  klass: PermissionClass
  decision: Decision
  /** scope matcher (glob-ish prefix); undefined = all scopes */
  scopePattern?: string
}

export interface Policy {
  rules: PolicyRule[]
}

/** v1 default policy per product scope: reads allowed where safe; writes,
 *  execution, deletion, installation, network require approval. */
export const DEFAULT_POLICY: Policy = {
  rules: [
    { klass: 'read', decision: 'allow' },
    { klass: 'edit', decision: 'ask' },
    { klass: 'execute', decision: 'ask' },
    { klass: 'network', decision: 'ask' },
    { klass: 'external-mcp', decision: 'ask' }
  ]
}

/** Strict mode used for tests / untrusted workspaces. */
export const STRICT_POLICY: Policy = {
  rules: [
    { klass: 'read', decision: 'ask' },
    { klass: 'edit', decision: 'ask' },
    { klass: 'execute', decision: 'deny' },
    { klass: 'network', decision: 'ask' },
    { klass: 'external-mcp', decision: 'deny' }
  ]
}

/** Decide a request against a policy. Later rules win (last match). */
export function decide(policy: Policy, request: Pick<PermissionRequest, 'klass' | 'scope'>): Decision {
  let decision: Decision = 'deny' // default deny
  for (const rule of policy.rules) {
    if (rule.klass !== request.klass) continue
    if (rule.scopePattern && !scopeMatches(rule.scopePattern, request.scope)) continue
    decision = rule.decision
  }
  return decision
}

/** Simple prefix/glob matching: '*' suffix wildcard, exact otherwise. */
export function scopeMatches(pattern: string, scope?: string): boolean {
  if (scope === undefined) return false
  if (pattern.endsWith('*')) return scope.startsWith(pattern.slice(0, -1))
  return scope === pattern
}
