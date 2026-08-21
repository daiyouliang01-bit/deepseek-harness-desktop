import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultDesktopHome,
  findProfileFileDepsIntoSharedHome,
  isSharedWebHome,
  materializeLeakedLinks,
  pointsIntoSharedHome,
  resolveDesktopDshHome,
  sharedWebHome
} from './dsh-home-isolation'

describe('dsh-home-isolation', () => {
  const roots: string[] = []
  function tmp(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    roots.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('never resolves to ~/.dsh even if configured or env says so', () => {
    const home = tmp('iso-home-')
    const shared = sharedWebHome(home)
    expect(isSharedWebHome(shared, home)).toBe(true)
    expect(
      resolveDesktopDshHome({ configured: shared, envHome: shared, home })
    ).toBe(defaultDesktopHome(home))
  })

  it('prefers a configured independent path over env and default', () => {
    const home = tmp('iso-home-')
    const custom = join(home, 'custom-desktop')
    expect(
      resolveDesktopDshHome({
        configured: custom,
        envHome: join(home, 'from-env'),
        home
      })
    ).toBe(custom)
  })

  it('uses env when configured is missing, still rejecting ~/.dsh', () => {
    const home = tmp('iso-home-')
    const fromEnv = join(home, 'from-env')
    expect(resolveDesktopDshHome({ envHome: fromEnv, home })).toBe(fromEnv)
    expect(resolveDesktopDshHome({ envHome: sharedWebHome(home), home })).toBe(
      defaultDesktopHome(home)
    )
  })

  it('copies leaked plugins/skills/json then replaces the symlink with a real tree', () => {
    const home = tmp('iso-home-')
    const shared = join(home, '.dsh')
    const desktop = join(home, '.dsh-desktop')
    mkdirSync(join(shared, 'plugins', 'keep-me'), { recursive: true })
    writeFileSync(join(shared, 'plugins', 'keep-me', 'ok.txt'), 'plugin-ok')
    mkdirSync(join(shared, 'skills', 's1'), { recursive: true })
    writeFileSync(join(shared, 'skills', 's1', 'SKILL.md'), '# skill')
    writeFileSync(join(shared, 'free-vision.json'), '{"src":"shared"}')
    mkdirSync(desktop, { recursive: true })
    symlinkSync(join(shared, 'plugins'), join(desktop, 'plugins'), 'dir')
    symlinkSync(join(shared, 'skills'), join(desktop, 'skills'), 'dir')
    symlinkSync(join(shared, 'free-vision.json'), join(desktop, 'free-vision.json'), 'file')

    const done = materializeLeakedLinks(desktop, shared)
    expect(done.sort()).toEqual(['free-vision.json', 'plugins', 'skills'])

    for (const name of done) {
      expect(lstatSync(join(desktop, name)).isSymbolicLink()).toBe(false)
    }
    expect(readFileSync(join(desktop, 'plugins', 'keep-me', 'ok.txt'), 'utf8')).toBe('plugin-ok')
    expect(readFileSync(join(desktop, 'skills', 's1', 'SKILL.md'), 'utf8')).toBe('# skill')
    expect(readFileSync(join(desktop, 'free-vision.json'), 'utf8')).toBe('{"src":"shared"}')

    // After disconnect, mutating desktop must not touch the 3080 tree.
    writeFileSync(join(desktop, 'plugins', 'keep-me', 'ok.txt'), 'desktop-only')
    expect(readFileSync(join(shared, 'plugins', 'keep-me', 'ok.txt'), 'utf8')).toBe('plugin-ok')
    expect(existsSync(join(shared, 'plugins', 'keep-me', 'ok.txt'))).toBe(true)
  })

  it('materializes a nested profiles/web symlink into ~/.dsh', () => {
    const home = tmp('iso-home-')
    const shared = join(home, '.dsh')
    const desktop = join(home, '.dsh-desktop')
    mkdirSync(join(shared, 'profiles', 'web', 'node_modules', '@dshd'), { recursive: true })
    writeFileSync(join(shared, 'profiles', 'web', 'cordis.yml'), 'shared: true\n')
    mkdirSync(join(desktop, 'profiles'), { recursive: true })
    symlinkSync(join(shared, 'profiles', 'web'), join(desktop, 'profiles', 'web'), 'dir')

    const done = materializeLeakedLinks(desktop, shared)
    expect(done).toContain(join('profiles', 'web'))
    expect(lstatSync(join(desktop, 'profiles', 'web')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(desktop, 'profiles', 'web', 'cordis.yml'), 'utf8')).toBe('shared: true\n')
    writeFileSync(join(desktop, 'profiles', 'web', 'cordis.yml'), 'desktop: true\n')
    expect(readFileSync(join(shared, 'profiles', 'web', 'cordis.yml'), 'utf8')).toBe('shared: true\n')
  })

  it('leaves real directories and unrelated symlinks alone', () => {
    const home = tmp('iso-home-')
    const shared = join(home, '.dsh')
    const desktop = join(home, '.dsh-desktop')
    const other = tmp('iso-other-')
    mkdirSync(join(desktop, 'sessions'), { recursive: true })
    mkdirSync(other, { recursive: true })
    mkdirSync(desktop, { recursive: true })
    symlinkSync(other, join(desktop, 'companion'), 'dir')
    mkdirSync(shared, { recursive: true })

    expect(pointsIntoSharedHome(join(desktop, 'sessions'), shared)).toBe(false)
    expect(materializeLeakedLinks(desktop, shared)).toEqual([])
    expect(lstatSync(join(desktop, 'companion')).isSymbolicLink()).toBe(true)
  })
})

describe('findProfileFileDepsIntoSharedHome', () => {
  const roots: string[] = []
  function tmp(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    roots.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('flags file: deps that point into the shared web home', () => {
    const home = tmp('iso-home-')
    const shared = join(home, '.dsh')
    const desktop = join(home, '.dsh-desktop')
    const profile = join(desktop, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@dshd/dsh-file-preview': `file:${join(shared, 'plugins', 'dsh-file-preview')}`,
          '@omdsh-dev/dsh-genui': `file:${join(home, 'plugins-dev', 'dsh-genui')}`,
          'dsh-better-sidebar': '0.13.1'
        }
      })
    )
    const leaked = findProfileFileDepsIntoSharedHome(profile, shared)
    expect(leaked).toEqual([`@dshd/dsh-file-preview -> file:${join(shared, 'plugins', 'dsh-file-preview')}`])
  })

  it('returns [] for clean profiles and unreadable dirs', () => {
    const home = tmp('iso-home-')
    const shared = join(home, '.dsh')
    const profile = join(home, '.dsh-desktop', 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, 'package.json'),
      JSON.stringify({ dependencies: { '@omdsh-dev/dsh-genui': `file:${join(home, 'plugins-dev', 'dsh-genui')}` } })
    )
    expect(findProfileFileDepsIntoSharedHome(profile, shared)).toEqual([])
    expect(findProfileFileDepsIntoSharedHome(join(home, 'nope'), shared)).toEqual([])
  })
})
