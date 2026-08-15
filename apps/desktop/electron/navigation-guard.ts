/**
 * Task 1.3 — navigation guard.
 *
 * The renderer may only ever load: the dev server (dev), files under the
 * bundled renderer directory, or a validated loopback origin (the official
 * Harness Web UI). Everything else — including arbitrary file:// paths and
 * remote origins — is blocked by the main process.
 */

export function isAllowedNavigation(
  url: string,
  devServerUrl?: string,
  rendererDirUrl?: string
): boolean {
  if (devServerUrl && url.startsWith(devServerUrl)) return true
  if (rendererDirUrl && url.startsWith(rendererDirUrl)) return true
  return /^http:\/\/127\.0\.0\.1(:\d+)?\//.test(url) || /^http:\/\/localhost(:\d+)?\//.test(url)
}
