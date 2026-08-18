/**
 * P1 — autolaunch (open-at-login) support, modeled on the official desktop.
 *
 * macOS uses SMAppService via Electron's login item settings; Windows uses a
 * hidden-launch Run-key argument (`--hidden`) so an autostart launch stays
 * out of the user's way. Detect "start hidden" from argv (Windows) or the
 * OS signal (macOS), and keep the window hidden in that case.
 */

export const HIDDEN_LAUNCH_ARG = '--hidden'

/** Electron main process surface this module needs (injectable for tests). */
export interface LoginWindowController {
  platform: NodeJS.Platform
  argv: readonly string[]
  /** Electron: whether the OS reports this launch as an open-at-login. */
  openedAtLogin(): boolean
  /** Electron: register/unregister the app with the OS login items. */
  setOpenAtLogin(enabled: boolean): void
  isOpenAtLogin(): boolean
}

/** Whether this launch must keep the window hidden (an autostart launch). */
export function shouldStartHidden(ctrl: LoginWindowController): boolean {
  if (ctrl.platform === 'darwin') return ctrl.openedAtLogin()
  return ctrl.argv.includes(HIDDEN_LAUNCH_ARG)
}

/** Toggle open-at-login (Windows keeps the hidden arg registered). */
export function setAutolaunch(ctrl: LoginWindowController, enabled: boolean): void {
  ctrl.setOpenAtLogin(enabled)
}

export function autolaunchEnabled(ctrl: LoginWindowController): boolean {
  return ctrl.isOpenAtLogin()
}
