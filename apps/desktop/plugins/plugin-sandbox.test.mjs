/**
 * Sandbox checks for the two persisted web plugins.
 * Run: node --test apps/desktop/plugins/plugin-sandbox.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))

function loadClient(id, file) {
  const window = {}
  let captured
  window.__ModuleLoader__ = {
    load(spec) {
      captured = spec
    },
  }
  globalThis.window = window
  return import(`${pathToFileURL(file).href}?t=${Date.now()}`).then(() => {
    assert.equal(captured.id, id)
    const fakeReact = {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
      useEffect: () => {},
      useCallback: (fn) => fn,
    }
    const exported = captured.factory((name) => {
      if (name === 'react') return fakeReact
      throw new Error(`unexpected require: ${name}`)
    })
    return exported
  })
}

test('community-links package.json is a valid dsh web bundle', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'community-links/package.json'), 'utf8'))
  assert.equal(pkg.name, '@dshd/community-links')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.exports['./client'])
})

test('phone-settings package.json is a valid dsh web bundle', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'phone-settings/package.json'), 'utf8'))
  assert.equal(pkg.name, '@dshd/phone-settings')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.exports['./client'])
})

test('community-links host half is a no-op plugin', async () => {
  const mod = await import(pathToFileURL(join(root, 'community-links/lib/index.js')).href)
  assert.equal(mod.default.name, 'community-links')
  assert.equal(typeof mod.default.apply, 'function')
  mod.default.apply()
})

test('phone-settings host half is a no-op plugin', async () => {
  const mod = await import(pathToFileURL(join(root, 'phone-settings/lib/index.js')).href)
  assert.equal(mod.default.name, 'phone-settings')
  assert.equal(typeof mod.default.apply, 'function')
  mod.default.apply()
})

test('coding-agent plugin ships a bundled process-bridge', async () => {
  const file = join(root, 'dsh-coding-agent/lib/process-bridge.js')
  const src = readFileSync(file, 'utf8')
  assert.match(src, /prepareProjectContextMessage/)
  assert.match(src, /SessionLoop/)
  assert.doesNotMatch(src, /@deepseek-ai\//)
})

test('coding-agent host apply registers a pre-step listener and does not reject', async () => {
  const mod = await import(`${pathToFileURL(join(root, 'dsh-coding-agent/lib/index.js')).href}?t=${Date.now()}`)
  const seen = []
  const plugin = mod.default
  assert.deepEqual(plugin.inject, ['tools', 'agents'])
  plugin.apply({
    on(name) {
      seen.push(name)
      return () => {}
    },
  })
  assert.ok(seen.includes('agent/pre-step'))
  assert.ok(seen.includes('tools/result'))
  assert.ok(seen.includes('turn/end'))
})

test('coding-agent host half is a no-op plugin and publishes no service', async () => {
  const pkg = JSON.parse(readFileSync(join(root, 'dsh-coding-agent/package.json'), 'utf8'))
  assert.equal(pkg.name, '@dshd/coding-agent-host')
  const patch = readFileSync(join(root, 'dsh-coding-agent/cordis.patch.yml'), 'utf8')
  assert.match(patch, /id: coding-agent/)
  assert.doesNotMatch(patch, /id: permission/)
  const mod = await import(pathToFileURL(join(root, 'dsh-coding-agent/lib/index.js')).href)
  assert.equal(mod.default.name, 'coding-agent')
  assert.equal(typeof mod.default.apply, 'function')
  assert.deepEqual(mod.default.inject, ['tools', 'agents'])
  mod.default.apply({ on() { return () => {} } })
})

test('community-links client registers 社区 settings + footer action', async () => {
  const registered = []
  const exported = await loadClient('@dshd/community-links', join(root, 'community-links/lib/client.js'))
  assert.deepEqual(exported.inject, ['slots'])
  exported.apply({
    get() {
      return undefined
    },
    slots: {
      inject(name, fn) {
        registered.push({ name, options: fn() })
        return () => {}
      },
      register(options) {
        return options
      },
    },
  })
  const names = registered.map((r) => r.name)
  assert.ok(names.includes('settings.section'))
  assert.ok(names.includes('sidebar.footer.action'))
  const section = registered.find((r) => r.name === 'settings.section').options
  assert.equal(section.id, 'community-links')
  assert.equal(section.label(), '社区')
})

test('phone-settings client registers 手机 settings and hides remote phone icon', async () => {
  const registered = []
  const effects = []
  const exported = await loadClient('@dshd/phone-settings', join(root, 'phone-settings/lib/client.js'))
  exported.apply({
    get() {
      return undefined
    },
    effect(fn) {
      effects.push(fn)
      return () => {}
    },
    slots: {
      inject(name, fn) {
        registered.push({ name, options: fn() })
        return () => {}
      },
      register(options) {
        return options
      },
    },
  })
  const section = registered.find((r) => r.name === 'settings.section').options
  assert.equal(section.id, 'phone-settings')
  assert.equal(section.label(), '手机')
  assert.equal(effects.length, 1)
  const src = readFileSync(join(root, 'phone-settings/lib/client.js'), 'utf8')
  assert.match(src, /移动端远程控制/)
  assert.match(src, /display: none/)
})

test('main process no longer injects the jumping phone FAB', () => {
  const main = readFileSync(new URL('../electron/main/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(main, /function injectPhoneFab/)
  assert.doesNotMatch(main, /dshd-phone-fab/)
  assert.match(main, /ensureCommunityLinksLinked/)
  assert.match(main, /ensurePhoneSettingsLinked/)
  assert.match(main, /ensureCodingAgentLinked/)
})
