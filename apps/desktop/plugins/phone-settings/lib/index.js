/**
 * @dshd/phone-settings — host half.
 *
 * Pure client-side UI plugin; the host half is a no-op so the bundle row
 * mounts cleanly in the profile composition (client UI is loaded by the web
 * app from the `./client` entry, see package.json `dsh.client`).
 */
export default {
  name: 'phone-settings',
  apply() {
    /* client-only — nothing to do on the host */
  },
}
