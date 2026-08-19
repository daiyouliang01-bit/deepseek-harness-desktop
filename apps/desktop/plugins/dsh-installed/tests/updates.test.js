import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkPluginUpdate, cleanNote, compareVersions, parseVersion } from '../lib/updates.js'

describe('compareVersions', () => {
  it('orders core versions', () => {
    assert.equal(compareVersions('1.2.4', '1.2.3') > 0, true)
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  })
  it('returns null instead of throwing on garbage', () => {
    assert.equal(compareVersions('not-a-version', '1.0.0'), null)
    assert.equal(parseVersion('latest'), null)
  })
})

describe('checkPluginUpdate', () => {
  it('never marks local packages as available', async () => {
    const result = await checkPluginUpdate({
      name: 'local-one',
      version: '1.0.0',
      spec: 'file:/tmp/x',
      origin: 'local',
    }, async () => {
      throw new Error('network should not be used')
    })
    assert.equal(result.status, 'local')
  })

  it('unknown origin cannot become available even if a registry answers', async () => {
    const result = await checkPluginUpdate({
      name: 'demo',
      version: '1.0.0',
      spec: 'https://gitlab.com/a/b',
      origin: 'unknown',
    }, async () => ({
      ok: true,
      json: async () => ({ version: '9.9.9' }),
    }))
    assert.equal(result.status, 'error')
  })

  it('reports available only when latest is a newer parsed semver', async () => {
    const result = await checkPluginUpdate({
      name: 'demo',
      version: '1.0.0',
      spec: '^1.0.0',
      origin: 'npm',
    }, async () => ({
      ok: true,
      json: async () => ({ version: '1.1.0' }),
    }))
    assert.equal(result.status, 'available')
    assert.equal(result.latest, '1.1.0')
  })

  it('treats network and parse failures as error, not available', async () => {
    const down = await checkPluginUpdate({
      name: 'demo',
      version: '1.0.0',
      spec: '^1.0.0',
      origin: 'npm',
    }, async () => ({ ok: false, status: 500, json: async () => ({}) }))
    assert.equal(down.status, 'error')
    assert.notEqual(down.status, 'available')

    const garbage = await checkPluginUpdate({
      name: 'demo',
      version: '1.0.0',
      spec: '^1.0.0',
      origin: 'npm',
    }, async () => ({ ok: true, json: async () => ({ version: 'not-semver' }) }))
    assert.equal(garbage.status, 'error')
  })

  it('rejects non-https update URLs via the npm helper path', async () => {
    const result = await checkPluginUpdate({
      name: 'demo',
      version: '1.0.0',
      origin: 'npm',
    }, async (url) => {
      assert.equal(String(url).startsWith('https://'), true)
      return { ok: true, json: async () => ({ version: '1.0.0' }) }
    })
    assert.equal(result.status, 'up-to-date')
  })

  it('prefers the github release and carries a chinese note', async () => {
    const result = await checkPluginUpdate({
      name: 'dsh-demo',
      version: '0.1.0',
      spec: 'github:someone/dsh-demo',
      origin: 'github',
      github: { owner: 'someone', repo: 'dsh-demo' },
    }, async (url) => {
      assert.ok(String(url).includes('api.github.com/repos/someone/dsh-demo/releases/latest'))
      return {
        ok: true,
        json: async () => ({
          tag_name: 'v0.2.0',
          html_url: 'https://github.com/someone/dsh-demo/releases/tag/v0.2.0',
          body: '## 修复\n- 修了崩溃\n- [链接](https://x) 更多',
        }),
      }
    })
    assert.equal(result.status, 'available')
    assert.equal(result.latest, '0.2.0')
    assert.ok(result.note.includes('修了崩溃'))
    assert.ok(!result.note.includes('[链接]'))
  })

  it('falls back to npm when the repo has no release', async () => {
    const result = await checkPluginUpdate({
      name: 'dsh-demo',
      version: '1.0.0',
      spec: 'github:someone/other-demo',
      origin: 'github',
      github: { owner: 'someone', repo: 'other-demo' },
    }, async (url) => {
      if (String(url).includes('api.github.com')) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, json: async () => ({ version: '1.1.0' }) }
    })
    assert.equal(result.status, 'available')
    assert.equal(result.latest, '1.1.0')
    assert.equal(result.note, '')
  })

  it('cleanNote collapses markdown into one line', () => {
    assert.equal(cleanNote('## 标题\n\n- 第一点\n- 第二点'), '标题 第一点 第二点')
    assert.equal(cleanNote('```code``` 之后'), '之后')
    assert.equal(cleanNote(''), '')
  })
})
