// src/client/md-render.ts
/** Minimal, dependency-free markdown renderer: headings, emphasis, inline
 * code, fenced code, lists, blockquote, links, images, tables, hr, escaping.
 * Unsupported syntax degrades to plain text. Returns an HTML string. */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(src: string): string {
  // Escape the raw text first so plain text (including <script> etc.) can
  // never inject HTML; markdown markers survive escaping, and captured
  // groups are already escaped so they must not be escaped a second time.
  let s = esc(src)
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => `<code>${c}</code>`)
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, c: string) => `<strong>${c}</strong>`)
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, (_m, pre: string, c: string) => `${pre}<em>${c}</em>`)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, href: string) => `<a href="${href}">${t}</a>`)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src2: string) => `<img src="${src2}" alt="${alt}">`)
  return s
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith('```')) { buf.push(lines[i]!); i++ }
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      i++
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) { out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`); i++; continue }
    if (line.startsWith('> ')) {
      const buf: string[] = []
      while (i < lines.length && lines[i]!.startsWith('> ')) { buf.push(lines[i]!.slice(2)); i++ }
      out.push(`<blockquote>${buf.map((l) => inline(l)).join('<br>')}</blockquote>`)
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) { items.push(inline(lines[i]!.replace(/^\s*[-*]\s+/, ''))); i++ }
      out.push(`<ul>${items.map((it) => `<li>${it}</li>`).join('')}</ul>`)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) { items.push(inline(lines[i]!.replace(/^\s*\d+\.\s+/, ''))); i++ }
      out.push(`<ol>${items.map((it) => `<li>${it}</li>`).join('')}</ol>`)
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1]!)) {
      const header = line.split('|').filter((s) => s.trim() !== '').map((s) => inline(s.trim()))
      i += 2
      const rows: string[] = []
      while (i < lines.length && lines[i]!.includes('|')) {
        rows.push(`<tr>${lines[i]!.split('|').filter((s) => s.trim() !== '').map((s) => `<td>${inline(s.trim())}</td>`).join('')}</tr>`)
        i++
      }
      out.push(`<table><thead><tr>${header.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`)
      continue
    }
    if (/^\s*---+\s*$/.test(line)) { out.push('<hr>'); i++; continue }
    if (line.trim() === '') { i++; continue }
    out.push(`<p>${inline(line)}</p>`)
    i++
  }
  return out.join('\n')
}
