/** Task 1.5 — system notifications for runtime state changes. */

import type { RuntimeStatus } from './runtime/runtime-types'

export interface NotificationBackend {
  show: (title: string, body: string, onClick?: () => void) => void
  isSupported: () => boolean
}

export class RuntimeNotifier {
  private readyNotified = false

  constructor(private readonly backend: NotificationBackend) {}

  /**
   * Public notification entry (task center + attention prompts use this).
   * {@link onClick} fires when the user clicks the notification — typically
   * to focus/restore the window.
   */
  notify(title: string, body: string, onClick?: () => void): void {
    this.backend.show(title, body, onClick)
  }

  /** Feed a runtime status change; notifies on first ready and on failures. */
  handleStatus(status: RuntimeStatus): void {
    if (!this.backend.isSupported()) return
    switch (status.state) {
      case 'ready':
        if (!this.readyNotified) {
          this.readyNotified = true
          this.backend.show('DeepSeek Harness Desktop', `Runtime ready at ${status.ready?.url ?? '127.0.0.1'}`)
        }
        break
      case 'error':
        this.backend.show('Runtime error', status.lastError ?? 'The Harness runtime failed to start.')
        break
      case 'stopped':
        this.backend.show('Runtime stopped', 'The Harness runtime has stopped.')
        break
      default:
        break
    }
  }
}
