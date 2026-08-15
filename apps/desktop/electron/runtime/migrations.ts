/** Task 2.3 — user-config backup/restore with hash verification. */

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

export interface BackupInfo {
  path: string
  sha256: string
  createdAt: string
}

const BACKUP_PREFIX = 'backup-'

/** Create a hash-verified backup of a file. Returns the backup info. */
export function backupFile(source: string, backupsDir: string): BackupInfo {
  mkdirSync(backupsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = join(backupsDir, `${BACKUP_PREFIX}${stamp}`)
  copyFileSync(source, dest)
  const sha256 = hashFile(dest)
  return { path: dest, sha256, createdAt: stamp }
}

/** Verify a backup's hash. Returns true when intact. */
export function verifyBackup(info: BackupInfo): boolean {
  if (!existsSync(info.path)) return false
  return hashFile(info.path) === info.sha256
}

/** Restore a verified backup over the target file. */
export function restoreBackup(info: BackupInfo, target: string): void {
  if (!verifyBackup(info)) throw new Error('backup failed hash verification; refusing to restore')
  mkdirSync(dirnameOf(target), { recursive: true })
  copyFileSync(info.path, target)
}

/** Keep only the N most recent backups. */
export function pruneBackups(backupsDir: string, keep: number): void {
  try {
    const files = readdirSync(backupsDir)
      .filter((f) => f.startsWith(BACKUP_PREFIX))
      .sort()
      .reverse()
    for (const f of files.slice(keep)) rmSync(join(backupsDir, f), { force: true })
  } catch {
    /* nothing to prune */
  }
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function dirnameOf(path: string): string {
  return join(path, '..')
}

export { renameSync as atomicWrite }
