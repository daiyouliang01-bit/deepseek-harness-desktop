/** Task 4.1 (v2.1 🆕) — cost guardrail: per-session token budget cap (ADR-008). */

export interface Budget {
  /** max tokens per session; undefined = unlimited */
  maxTokens?: number
  /** hard stop: block new tool calls once exceeded (never mid-call) */
  blockNewCalls: boolean
}

export class BudgetTracker {
  private usedTokens = 0
  private blocked = false

  constructor(private readonly budget: Budget) {}

  /** Record token usage from a run; returns the new total. */
  record(tokens: number): number {
    this.usedTokens += tokens
    if (this.budget.maxTokens !== undefined && this.usedTokens >= this.budget.maxTokens) {
      this.blocked = true
    }
    return this.usedTokens
  }

  /** Whether new tool calls are allowed. */
  canExecute(): boolean {
    if (!this.budget.blockNewCalls) return true
    return !this.blocked
  }

  /** Remaining budget, or null when unlimited. */
  remaining(): number | null {
    if (this.budget.maxTokens === undefined) return null
    return Math.max(0, this.budget.maxTokens - this.usedTokens)
  }

  /** Whether the session has been budget-blocked. */
  isBlocked(): boolean {
    return this.blocked
  }

  /** Reset for a new session. */
  reset(): void {
    this.usedTokens = 0
    this.blocked = false
  }
}
