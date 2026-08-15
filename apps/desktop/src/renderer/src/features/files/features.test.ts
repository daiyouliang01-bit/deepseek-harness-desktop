import { describe, expect, it } from 'vitest'
import { buildArtifactPreview, classifyArtifact } from '../artifacts/artifact-preview'
import { parseUnifiedDiff, simpleDiff } from '../files/diff'
import { buildTree, walkFiles, withinWorkspace } from '../files/file-tree'
import { JobTracker } from '../terminal/jobs'

describe('file tree', () => {
  it('builds a sorted tree from flat paths', () => {
    const tree = buildTree(['src/main.ts', 'src/util/helper.ts', 'README.md', 'package.json'])
    const names = tree.map((n) => n.name)
    expect(names[0]).toBe('src') // dirs first
    expect(names).toContain('README.md')
    const src = tree.find((n) => n.name === 'src')
    expect(src?.children?.map((c) => c.name)).toEqual(['util', 'main.ts'])
  })

  it('walks all files depth-first', () => {
    const tree = buildTree(['a/b/c.txt', 'a/d.txt', 'e.txt'])
    expect(walkFiles(tree)).toEqual(['a/b/c.txt', 'a/d.txt', 'e.txt'])
  })

  it('scopes the tree to a workspace prefix', () => {
    const tree = buildTree(['proj/src/a.ts', 'proj/docs/b.md', 'other/x.ts'])
    const scoped = withinWorkspace(tree, 'proj')
    expect(walkFiles(scoped).sort()).toEqual(['src/a.ts', 'docs/b.md'].sort())
  })
})

describe('diff review', () => {
  it('parses unified diffs with hunks', () => {
    const diff = `--- a/f.ts\n+++ b/f.ts\n@@ -1,3 +1,4 @@\n line1\n-line2\n+line2 changed\n+line3\n line4\n`
    const parsed = parseUnifiedDiff(diff, 'f.ts')
    expect(parsed.path).toBe('f.ts')
    expect(parsed.additions).toBe(2)
    expect(parsed.deletions).toBe(1)
    const adds = parsed.lines.filter((l) => l.kind === 'add')
    expect(adds.map((l) => l.text)).toEqual(['line2 changed', 'line3'])
    expect(parsed.lines.some((l) => l.text.includes('@@'))).toBe(true)
  })

  it('computes simple before/after diffs', () => {
    const d = simpleDiff('a\nb\n', 'a\nc\n', 'f.txt')
    expect(d.additions).toBe(1)
    expect(d.deletions).toBe(1)
    expect(d.lines.filter((l) => l.kind === 'remove')[0].text).toBe('b')
    expect(d.lines.filter((l) => l.kind === 'add')[0].text).toBe('c')
  })
})

describe('artifact preview whitelist', () => {
  it('blocks html/svg/js from rendering', () => {
    expect(classifyArtifact('page.html', 'text/html')).toBe('blocked')
    expect(classifyArtifact('icon.svg', 'image/svg+xml')).toBe('blocked')
    expect(classifyArtifact('app.js', 'text/javascript')).toBe('blocked')
    const preview = buildArtifactPreview('page.html', 'text/html', '<script>x</script>')
    expect(preview.kind).toBe('blocked')
    expect(preview.reason).toMatch(/no HTML\/JS execution/)
    expect(preview.content).toBeUndefined()
  })

  it('allows text, markdown, json, csv, images', () => {
    expect(classifyArtifact('a.md', 'text/markdown')).toBe('markdown')
    expect(classifyArtifact('b.json', 'application/json')).toBe('json')
    expect(classifyArtifact('c.csv', 'text/csv')).toBe('csv')
    expect(classifyArtifact('d.txt', 'text/plain')).toBe('text')
    expect(classifyArtifact('e.png', 'image/png')).toBe('image')
    const p = buildArtifactPreview('b.json', 'application/json', '{"a":1}')
    expect(p.content).toBe('{"a":1}')
  })

  it('truncates oversized content', () => {
    const p = buildArtifactPreview('big.txt', 'text/plain', 'x'.repeat(200_000), 100)
    expect(p.content?.length).toBeLessThanOrEqual(100 + 20)
    expect(p.content).toContain('truncated')
  })
})

describe('job tracker', () => {
  it('tracks the full job lifecycle', () => {
    const tracker = new JobTracker()
    const job = tracker.submit('ls -la')
    expect(job.status).toBe('queued')
    tracker.start(job.id)
    expect(tracker.get(job.id)?.status).toBe('running')
    tracker.appendOutput(job.id, 'total 0')
    tracker.finish(job.id, 0)
    const done = tracker.get(job.id)
    expect(done?.status).toBe('succeeded')
    expect(done?.exitCode).toBe(0)
    expect(done?.output).toEqual(['total 0'])
    expect(done?.finishedAt).toBeTruthy()
  })

  it('marks failures and supports cancellation', () => {
    const tracker = new JobTracker()
    const fail = tracker.submit('false')
    tracker.start(fail.id)
    tracker.finish(fail.id, 1)
    expect(tracker.get(fail.id)?.status).toBe('failed')

    const cancel = tracker.submit('sleep 100')
    tracker.start(cancel.id)
    tracker.cancel(cancel.id)
    expect(tracker.get(cancel.id)?.status).toBe('cancelled')
  })

  it('lists newest first', () => {
    const tracker = new JobTracker()
    const a = tracker.submit('a')
    const b = tracker.submit('b')
    expect(tracker.list().map((j) => j.id)).toEqual([b.id, a.id])
  })
})
