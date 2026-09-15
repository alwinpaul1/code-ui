export type MobileMarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string; language?: string; closed: boolean }
  | { type: 'list'; ordered: boolean; items: Array<{ text: string; checked?: boolean }> }
  | { type: 'image'; alt: string; url: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'rule' }

const ESCAPED_PIPE = '\u0000'

// The paragraph loop below stops at the same lines the block dispatchers claim.
// Both sides must test the SAME pattern: a looser guard (`startsWith('```')`)
// stops the paragraph on a line no dispatcher will consume, so the index never
// advances and the parser spins forever on ```c++ or on a bare `# `.
const HEADING = /^(#{1,6})\s+(.+)$/
const CODE_FENCE = /^```([A-Za-z0-9_-]+)?\s*$/

function splitTableRow(line: string): string[] {
  // An escaped pipe (`\|`) is a literal inside a cell, not a column break.
  return line
    .trim()
    .replace(/\\\|/g, ESCAPED_PIPE)
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim().split(ESCAPED_PIPE).join('|'))
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  // Agents emit `|:-:|` and `| - |` as often as `| --- |`; GFM accepts one dash.
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

export function parseMobileMarkdown(content: string): MobileMarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MobileMarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(CODE_FENCE)
    if (fence) {
      index += 1
      const code: string[] = []
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      // closed=false means the fence is still streaming in (no terminator yet).
      const closed = index < lines.length
      if (closed) {
        index += 1
      }
      blocks.push({ type: 'code', text: code.join('\n'), language: fence[1], closed })
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    const standaloneImage = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)\s*$/i)
    if (standaloneImage) {
      blocks.push({ type: 'image', alt: standaloneImage[1] ?? '', url: standaloneImage[2]! })
      index += 1
      continue
    }

    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1] ?? '')
    ) {
      const headers = splitTableRow(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && (lines[index] ?? '').includes('|') && lines[index]?.trim()) {
        rows.push(splitTableRow(lines[index] ?? ''))
        index += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]!.trim() })
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'quote', text: quote.join('\n').trim() })
      continue
    }

    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      const items: Array<{ text: string; checked?: boolean }> = []
      let ordered = false
      while (index < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index] ?? '')) {
        const current = lines[index] ?? ''
        const orderedMatch = current.match(/^\s*\d+[.)]\s+(.+)$/)
        const unorderedMatch = current.match(/^\s*[-*+]\s+(.+)$/)
        ordered ||= Boolean(orderedMatch)
        const rawText = (orderedMatch?.[1] ?? unorderedMatch?.[1] ?? '').trim()
        index += 1
        // A wrapped item continues on the lines under it: indented, non-blank,
        // and not a marker of its own. Without this the list ended at the first
        // continuation line, that line became its own paragraph at the left
        // margin, and the next item opened a fresh list — so every item was
        // numbered 1 (2026-09-15, CLAUDE.md on the phone). Markdown hard-wrapped
        // at 80 columns is the normal shape of this project's docs and of
        // anything an agent writes.
        const continued = [rawText]
        while (index < lines.length) {
          const next = lines[index] ?? ''
          if (!next.trim() || !/^\s/.test(next) || /^\s*(?:[-*+]|\d+[.)])\s+/.test(next)) {
            break
          }
          continued.push(next.trim())
          index += 1
        }
        // Joined with a space: a single newline inside a paragraph is not a
        // line break in markdown, it reflows.
        const itemText = continued.join(' ')
        const task = itemText.match(/^\[([ xX])\]\s+(.+)$/)
        items.push({
          text: task?.[2] ?? itemText,
          checked: task ? task[1]?.toLowerCase() === 'x' : undefined
        })
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index]?.trim() &&
      !CODE_FENCE.test(lines[index] ?? '') &&
      !HEADING.test(lines[index] ?? '') &&
      !/^>\s?/.test(lines[index] ?? '') &&
      !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index] ?? '') &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index] ?? '')
    ) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() })
  }

  return blocks
}
