/** Task 4.1 — local audit log: who / when / what / outcome. */

export interface AuditEntry {
  ts: number
  actor: string
  action: string
  klass: string
  scope?: string
  outcome: 'allowed' | 'denied' | 'approved' | 'rejected' | 'blocked'
  detail?: unknown
}

export class AuditLog {
  private entries: AuditEntry[] = []

  constructor(private readonly limit = 5_000) {}

  record(entry: Omit<AuditEntry, 'ts'>): void {
    this.entries.push({ ...entry, ts: Date.now() })
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit)
    }
  }

  list(filter?: { actor?: string; klass?: string }): AuditEntry[] {
    let out = this.entries
    if (filter?.actor) out = out.filter((e) => e.actor === filter.actor)
    if (filter?.klass) out = out.filter((e) => e.klass === filter.klass)
    return [...out]
  }

  clear(): void {
    this.entries = []
  }
}
