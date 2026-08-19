/**
 * Coding Agent host plugin installer.
 *
 * Mirrors phone-settings-installer: dsh resolves @dshd/coding-agent-host from
 * the web profile's node_modules. Link the bundled plugin dir there before
 * spawn. Idempotent and never fatal.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

export const CODING_AGENT_PACKAGE = '@dshd/coding-agent-host'

export function codingAgentSourceDir(appRoot: string): string {
  return join(appRoot, 'plugins', 'dsh-coding-agent')
}

export function resolveCodingAgentSource(appRoot: string, resourcesPath?: string): string | null {
  for (const root of [appRoot, resourcesPath]) {
    if (!root) continue
    const dir = join(root, 'plugins', 'dsh-coding-agent')
    if (existsSync(dir)) return dir
  }
  return null
}

export function resolveCodingAgentSkillsSource(appRoot: string, resourcesPath?: string): string | null {
  for (const root of [appRoot, resourcesPath]) {
    if (!root) continue
    const dir = join(root, 'skills')
    if (existsSync(dir)) return dir
  }
  return null
}

export function codingAgentTargetDir(dshHome: string): string {
  return join(dshHome, 'profiles', 'web', 'node_modules', '@dshd')
}

export function ensureCodingAgentLinked(dshHome: string, appRoot: string, resourcesPath?: string): string | null {
  try {
    const source = resolveCodingAgentSource(appRoot, resourcesPath)
    if (!source) return null
    const targetDir = codingAgentTargetDir(dshHome)
    const linkPath = join(targetDir, 'coding-agent-host')
    if (existsSync(linkPath)) {
      try {
        if (readlinkSync(linkPath) !== source) {
          const { rmSync } = require('node:fs') as typeof import('node:fs')
          rmSync(linkPath, { force: true })
          mkdirSync(targetDir, { recursive: true })
          symlinkSync(source, linkPath, 'dir')
        }
      } catch {
        /* not a symlink — leave it */
      }
      ensureCodingAgentSkillsLinked(dshHome, appRoot, resourcesPath)
      return linkPath
    }
    mkdirSync(targetDir, { recursive: true })
    symlinkSync(source, linkPath, 'dir')
    ensureCodingAgentSkillsLinked(dshHome, appRoot, resourcesPath)
    return linkPath
  } catch {
    return null
  }
}

export function codingAgentSkillsSourceDir(appRoot: string): string {
  return join(appRoot, 'skills')
}

export function ensureCodingAgentSkillsLinked(dshHome: string, appRoot: string, resourcesPath?: string): string[] {
  const linked: string[] = []
  try {
    const sourceRoot = resolveCodingAgentSkillsSource(appRoot, resourcesPath) ?? codingAgentSkillsSourceDir(appRoot)
    if (!existsSync(sourceRoot)) return linked
    const targetRoot = join(dshHome, 'skills')
    mkdirSync(targetRoot, { recursive: true })
    for (const name of readdirSync(sourceRoot)) {
      const source = join(sourceRoot, name)
      const target = join(targetRoot, name)
      try {
        if (!existsSync(join(source, 'SKILL.md'))) continue
        if (existsSync(target)) {
          try {
            if (readlinkSync(target) !== source) {
              const { rmSync } = require('node:fs') as typeof import('node:fs')
              rmSync(target, { force: true })
              symlinkSync(source, target, 'dir')
            }
            linked.push(target)
          } catch {
            if (lstatSync(target).isDirectory()) continue
          }
          continue
        }
        symlinkSync(source, target, 'dir')
        linked.push(target)
      } catch {
        /* skip one skill, never throw */
      }
    }
  } catch {
    return linked
  }
  return linked
}
