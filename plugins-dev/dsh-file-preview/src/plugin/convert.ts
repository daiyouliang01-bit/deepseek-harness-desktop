// src/plugin/convert.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

/** macOS textutil: docx/doc/rtf → HTML. Returns {html} or {error}. */
export async function docxToHtml(p: string): Promise<{ html: string } | { error: string }> {
  const work = await mkdtemp(join(tmpdir(), 'fp-docx-'))
  const out = join(work, `${randomUUID()}.html`)
  try {
    await execFileAsync('textutil', ['-convert', 'html', '-output', out, p], { timeout: 15_000 })
    const html = await readFile(out, 'utf-8')
    return { html }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
