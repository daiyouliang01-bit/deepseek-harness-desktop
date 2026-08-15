/** Task 1.5 — global shortcut to summon the window. */

/** Injectable backend so the manager is unit-testable outside Electron. */
export interface ShortcutBackend {
  register: (accelerator: string, callback: () => void) => boolean
  unregister: (accelerator: string) => void
  unregisterAll: () => void
}

export const DEFAULT_SUMMON_ACCELERATOR = 'CommandOrControl+Shift+Space'

export class GlobalShortcutManager {
  private registered = false
  private readonly accelerator: string

  constructor(
    private readonly backend: ShortcutBackend,
    private readonly onSummon: () => void,
    accelerator?: string
  ) {
    this.accelerator = accelerator ?? DEFAULT_SUMMON_ACCELERATOR
  }

  /** Register the summon shortcut. Returns false when the key is taken. */
  register(): boolean {
    if (this.registered) return true
    this.registered = this.backend.register(this.accelerator, () => this.onSummon())
    return this.registered
  }

  unregister(): void {
    if (!this.registered) return
    this.backend.unregister(this.accelerator)
    this.registered = false
  }

  dispose(): void {
    this.unregister()
    this.backend.unregisterAll()
  }
}
