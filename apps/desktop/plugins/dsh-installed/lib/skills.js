/** Scan user/project skill roots. Bundled and runtime skills are out of scope. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/

/**
 * Lightweight SKILL.md frontmatter. Unknown YAML is ignored.
 * @param {string} content
 */
export function parseFrontmatter(content) {
  const match = FRONTMATTER.exec(content)
  if (match === null) return {}
  /** @type {Record<string, string>} */
  const out = {}
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (line === '' || line.startsWith('#') || line.startsWith(' ')) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * @param {string} dir
 * @returns {string | null}
 */
export function readGitRemote(dir) {
  try {
    const git = join(dir, '.git')
    if (!existsSync(git)) return null
    const stat = statSync(git)
    const configPath = stat.isDirectory() ? join(git, 'config') : null
    if (configPath === null) return null
    const config = readFileSync(configPath, 'utf8')
    const match = /\[remote "origin"\][\s\S]*?url\s*=\s*(\S+)/.exec(config)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * @param {string} root
 * @param {'user-agents' | 'user-dsh' | 'project-agents' | 'project-dsh'} key
 */
function scanRoot(root, key) {
  /** @type {Array<Record<string, unknown>>} */
  const items = []
  try {
    if (!existsSync(root) || !statSync(root).isDirectory()) return items
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (entry.name.startsWith('.')) continue
      const dir = join(root, entry.name)
      const skillFile = join(dir, 'SKILL.md')
      try {
        if (!existsSync(skillFile) || !statSync(skillFile).isFile()) continue
        const content = readFileSync(skillFile, 'utf8')
        const meta = parseFrontmatter(content)
        const name = meta.name || entry.name
        items.push({
          kind: 'skill',
          id: `${key}:${entry.name}`,
          name,
          description: meta.description || '',
          whenToUse: meta.whenToUse || null,
          version: meta.version || null,
          root: key,
          folder: entry.name,
          gitRemote: readGitRemote(dir),
        })
      } catch {
        // unreadable skill: skip
      }
    }
  } catch {
    // unreadable root: skip
  }
  return items
}

/**
 * @param {{ homedir: string, dshHome: string, cwd?: string | null }} roots
 */
export function readUserSkills(roots) {
  const items = [
    ...scanRoot(join(roots.homedir, '.agents', 'skills'), 'user-agents'),
    ...scanRoot(join(roots.dshHome, 'skills'), 'user-dsh'),
  ]
  const cwd = typeof roots.cwd === 'string' && roots.cwd.length > 0 ? roots.cwd : null
  if (cwd !== null && cwd.includes(sep) && existsSync(cwd)) {
    items.push(...scanRoot(join(cwd, '.agents', 'skills'), 'project-agents'))
    items.push(...scanRoot(join(cwd, '.dsh', 'skills'), 'project-dsh'))
  }
  return items.sort((left, right) => String(left.name).localeCompare(String(right.name)))
}
