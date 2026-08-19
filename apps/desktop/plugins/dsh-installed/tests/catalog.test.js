import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  decoratePlugins,
  localUpdateTargets,
  readDisabledIds,
  WEB_UI_ALL,
  WEB_UI_SETTINGS,
} from '../lib/catalog.js'
import { selectApplyItems, specsOf } from '../lib/apply.js'

describe('readDisabledIds', () => {
  it('reads disabled rows from a user patch', () => {
    const ids = readDisabledIds(`
- id: web-ui-ssh
  disabled: true
- id: web-ui-settings
  disabled: true
- insert:
    - id: dsh-installed
`)
    assert.equal(ids.has('web-ui-ssh'), true)
    assert.equal(ids.has('web-ui-settings'), true)
    assert.equal(ids.has('dsh-installed'), false)
  })
})

describe('decoratePlugins', () => {
  it('hides the web-ui aggregate and settings page, keeps enabled features', () => {
    const plugins = decoratePlugins([
      { name: WEB_UI_ALL, description: 'bundle', origin: 'npm', version: '0.2.1' },
      { name: WEB_UI_SETTINGS, description: 'settings', origin: 'npm', version: '0.2.1' },
      { name: 'dsh-context', description: 'Context panel', origin: 'npm', version: '0.13.0' },
    ], {
      disabled: new Set(['web-ui-ssh', 'web-ui-remote-web-ui', 'web-ui-settings', 'web-ui-community-plugins', 'web-ui-liangshen', 'web-ui-skin-center']),
      featureVersions: { '@linxin666/dsh-client-ui-task-board': '0.2.1' },
    })
    const names = plugins.map((item) => item.name)
    assert.equal(names.includes(WEB_UI_ALL), false)
    assert.equal(names.includes(WEB_UI_SETTINGS), false)
    assert.equal(names.includes('@linxin666/dsh-ssh'), false)
    assert.equal(names.includes('@linxin666/dsh-client-ui-task-board'), true)
    const board = plugins.find((item) => item.name === '@linxin666/dsh-client-ui-task-board')
    assert.equal(board.titleZh, '任务看板')
    assert.equal(board.summaryZh.includes('看板'), true)
    const context = plugins.find((item) => item.name === 'dsh-context')
    assert.equal(context.titleZh, '会话上下文')
  })
})

describe('localUpdateTargets', () => {
  it('only applies enabled local features, never the removed ones', () => {
    const items = [
      { name: 'dsh-context', origin: 'npm', update: { status: 'available', latest: '0.14.0' } },
      { name: '@linxin666/dsh-ssh', origin: 'npm', update: { status: 'available', latest: '0.3.0' } },
      { name: WEB_UI_ALL, origin: 'npm', update: { status: 'available', latest: '0.3.0' } },
      { name: 'local-one', origin: 'local', update: { status: 'local' } },
    ]
    const disabled = new Set(['web-ui-ssh'])
    const local = localUpdateTargets(items, disabled)
    assert.deepEqual(local.map((item) => item.name), ['dsh-context'])
    const complete = selectApplyItems(items, { mode: 'complete', ids: ['@linxin666/dsh-ssh'], disabled })
    assert.deepEqual(complete.map((item) => item.name), ['@linxin666/dsh-ssh'])
    assert.deepEqual(specsOf(local), ['dsh-context@0.14.0'])
  })
})
