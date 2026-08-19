export type HookName = 'beforeTool' | 'afterTool' | 'afterEdit' | 'beforeTask' | 'afterTask'

type HookFn = (payload: unknown) => void

export class HookRegistry {
  /** Bounded error log so a hook that always throws cannot grow forever. */
  readonly errors: Array<{ name: HookName; error: unknown }> = []
  readonly MAX_ERRORS = 20
  #listeners: Record<HookName, HookFn[]> = {
    beforeTool: [],
    afterTool: [],
    afterEdit: [],
    beforeTask: [],
    afterTask: [],
  }

  on(name: HookName, fn: HookFn): () => void {
    this.#listeners[name].push(fn)
    return () => {
      this.#listeners[name] = this.#listeners[name].filter((item) => item !== fn)
    }
  }

  run(name: HookName, payload: unknown): void {
    for (const fn of this.#listeners[name]) {
      try {
        fn(payload)
      } catch (error) {
        this.errors.push({ name, error })
        if (this.errors.length > this.MAX_ERRORS) this.errors.shift()
      }
    }
  }
}
