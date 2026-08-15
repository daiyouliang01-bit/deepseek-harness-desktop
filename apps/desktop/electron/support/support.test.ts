import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { audit, annotateLicenses, parseLockfile } from '../../scripts/license-audit'
import { buildSupportBundle, scanForSecrets } from '../support/support-bundle'

describe('license audit', () => {
  it('parses lockfile entries', () => {
    const text = [
      'lockfileVersion: "9.0"',
      '  @electron/get@5.1.0:',
      '    resolution: {integrity: sha512-xyz}',
      '  electron@43.4.0:',
      '    resolution: {integrity: sha512-abc}',
      '  some-gpl-pkg@1.0.0:'
    ].join('\n')
    const entries = parseLockfile(text)
    expect(entries.map((e) => e.name)).toEqual(['@electron/get', 'electron', 'some-gpl-pkg'])
    expect(entries[0].version).toBe('5.1.0')
  })

  it('annotates licenses and flags non-permissive ones', () => {
    const entries = parseLockfile('  electron@43.4.0:\n  gpl-thing@2.0.0:\n')
    const annotated = annotateLicenses(entries, [
      { name: 'electron', license: 'MIT' },
      { name: 'gpl-thing', license: 'GPL-3.0' }
    ])
    const flagged = audit(annotated)
    expect(flagged.map((e) => e.name)).toEqual(['gpl-thing'])
    expect(annotated.find((e) => e.name === 'electron')?.permissive).toBe(true)
  })

  it('treats unknown licenses as non-permissive', () => {
    const entries = annotateLicenses(parseLockfile('  mystery@1.0.0:\n'), [])
    expect(audit(entries)).toHaveLength(1)
    expect(entries[0].license).toBe('UNKNOWN')
  })
})

describe('support bundle', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshd-bundle-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('collects logs, info, and extra files, excluding secrets', () => {
    const logs = join(dir, 'logs')
    mkdirSync(logs, { recursive: true })
    writeFileSync(join(logs, 'dsh-runtime.log'), 'hello')
    writeFileSync(join(logs, 'secrets.json'), '{"k":"v"}') // must be excluded

    const secrets = join(dir, 'config', 'secrets.json')
    mkdirSync(join(dir, 'config'), { recursive: true })
    writeFileSync(secrets, '{}')

    const bundle = buildSupportBundle(
      {
        logsDir: logs,
        appVersion: '0.1.0',
        runtimeVersion: '0.1.0-rc.6',
        platform: 'darwin',
        extraFiles: [secrets],
        excludedPaths: ['secrets.json']
      },
      dir
    )
    expect(bundle.files).toContain('info.json')
    expect(bundle.files).toContain('logs/dsh-runtime.log')
    expect(bundle.files).not.toContain('logs/secrets.json')
    expect(bundle.files).not.toContain('extra/secrets.json') // excluded path skipped
  })

  it('scanForSecrets detects embedded keys in collected files', () => {
    const bundleDir = join(dir, 'bundle')
    mkdirSync(bundleDir, { recursive: true })
    writeFileSync(join(bundleDir, 'leak.txt'), 'key=sk-abcdefghijklmnopqrstuvwxyz123456')
    writeFileSync(join(bundleDir, 'clean.txt'), 'no secrets here')
    const hits = scanForSecrets(bundleDir)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('leak.txt')
  })
})
