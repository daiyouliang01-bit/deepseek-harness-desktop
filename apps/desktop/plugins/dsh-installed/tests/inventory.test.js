import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifySpec, parseGithubSpec, readUserPlugins } from '../lib/inventory.js'

function fixtureProfile() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-installed-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    dependencies: {
      '@deepseek-ai/dsh-base': '^1.0.0',
      dsh1024: '^0.3.1',
      'dsh-context': '^0.13.0',
      '@omdsh-dev/dsh-genui': 'file:/tmp/genui',
    },
  }))
  mkdirSync(join(root, 'node_modules', 'dsh1024'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'dsh1024', 'package.json'), JSON.stringify({
    name: 'dsh1024',
    version: '0.3.1',
    description: 'The 1024 Store',
  }))
  mkdirSync(join(root, 'node_modules', 'dsh-context'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'dsh-context', 'package.json'), JSON.stringify({
    name: 'dsh-context',
    version: '0.13.0',
    description: 'Context panel',
  }))
  mkdirSync(join(root, 'node_modules', '@omdsh-dev', 'dsh-genui'), { recursive: true })
  writeFileSync(join(root, 'node_modules', '@omdsh-dev', 'dsh-genui', 'package.json'), JSON.stringify({
    name: '@omdsh-dev/dsh-genui',
    version: '1.2.3',
    description: 'GenUI',
  }))
  const localPlugin = join(root, 'community-links')
  mkdirSync(localPlugin)
  writeFileSync(join(localPlugin, 'package.json'), JSON.stringify({
    name: '@dshd/community-links',
    version: '1.0.0',
    description: 'Community links',
  }))
  mkdirSync(join(root, 'node_modules', '@dshd'), { recursive: true })
  symlinkSync(localPlugin, join(root, 'node_modules', '@dshd', 'community-links'))
  return root
}

describe('classifySpec', () => {
  it('treats file and link specs as local', () => {
    assert.equal(classifySpec('file:/tmp/x'), 'local')
    assert.equal(classifySpec('link:/tmp/x'), 'local')
    assert.equal(classifySpec('./packages/foo'), 'local')
  })
  it('detects github specs', () => {
    assert.equal(classifySpec('github:MirDie/dsh-xai'), 'github')
    assert.deepEqual(parseGithubSpec('github:MirDie/dsh-xai'), { owner: 'MirDie', repo: 'dsh-xai' })
  })
  it('defaults version ranges to npm', () => {
    assert.equal(classifySpec('^0.3.1'), 'npm')
    assert.equal(classifySpec('0.10.3'), 'npm')
    assert.equal(classifySpec('latest'), 'npm')
  })
  it('does not treat workspace/catalog/unknown specs as npm', () => {
    assert.equal(classifySpec('workspace:*'), 'local')
    assert.equal(classifySpec('catalog:'), 'local')
    assert.equal(classifySpec('git+ssh://git@github.com/a/b.git'), 'github')
    assert.equal(classifySpec('https://gitlab.com/a/b'), 'unknown')
  })
})

describe('readUserPlugins', () => {
  it('drops official @deepseek-ai packages and keeps user deps plus @dshd', () => {
    const profile = fixtureProfile()
    const plugins = readUserPlugins(profile)
    const names = plugins.map((item) => item.name)
    assert.deepEqual(names, ['@dshd/community-links', '@omdsh-dev/dsh-genui', 'dsh-context', 'dsh1024'])
    const genui = plugins.find((item) => item.name === '@omdsh-dev/dsh-genui')
    assert.equal(genui.origin, 'local')
    assert.equal(genui.version, '1.2.3')
    assert.equal(genui.description, 'GenUI')
    const store = plugins.find((item) => item.name === 'dsh1024')
    assert.equal(store.origin, 'npm')
    assert.equal(store.description, 'The 1024 Store')
  })

  it('parses object-form repository into github owner/repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-installed-repo-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dependencies: { 'dsh-demo': '^1.0.0' },
    }))
    mkdirSync(join(root, 'node_modules', 'dsh-demo'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'dsh-demo', 'package.json'), JSON.stringify({
      name: 'dsh-demo',
      version: '1.0.0',
      repository: { type: 'git', url: 'git+https://github.com/someone/dsh-demo.git' },
    }))
    const [plugin] = readUserPlugins(root)
    assert.deepEqual(plugin.github, { owner: 'someone', repo: 'dsh-demo' })
    assert.equal(plugin.repository, 'git+https://github.com/someone/dsh-demo.git')
  })

  it('returns empty on missing or corrupt manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-installed-empty-'))
    assert.deepEqual(readUserPlugins(root), [])
    writeFileSync(join(root, 'package.json'), '{not json')
    assert.deepEqual(readUserPlugins(root), [])
  })
})
