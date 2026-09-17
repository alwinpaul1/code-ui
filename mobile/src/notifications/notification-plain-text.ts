/**
 * Agents summarise their turn in Markdown; Android notifications take plain
 * strings and render none of it, so "**Done** — fixed `foo`" showed its
 * asterisks and backticks. There is no styled-text API in expo-notifications,
 * but the shade renders any Unicode, so emphasis is carried by the
 * Mathematical Alphanumeric letterforms: **bold** → 𝗯𝗼𝗹𝗱, *italic* → 𝘪𝘵𝘢𝘭𝘪𝘤,
 * `code` → 𝚌𝚘𝚍𝚎. Only ASCII letters and digits have such forms; anything else
 * is kept as typed. Headings read as bold, list markers become "•", links keep
 * their visible text, and blank-line runs collapse.
 */
export function notificationPlainText(markdown: string): string {
  const raw = markdown.replace(/\r\n?/g, '\n').split('\n')
  const lines = raw
    .map((line) =>
      line
        .replace(/^\s*(```+|~~~+)[^\n]*$/, '')
        .replace(/^\s{0,3}#{1,6}\s+(.*)$/, (_, text: string) => styleText(text, 'bold'))
        .replace(/^(\s*)[*\-+]\s+/, '$1• ')
        .replace(/^\s*>\s?/, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, (_, text: string) => styleText(text, 'mono'))
        .replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, (_, __, text: string) =>
          styleText(text, 'bolditalic')
        )
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, (_, __, text: string) => styleText(text, 'bold'))
        .replace(/(^|[^\w*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\w)/g, (_, lead: string, text: string) =>
          lead + styleText(text, 'italic')
        )
        .replace(/(^|[^\w_])_([^_\s](?:[^_]*?[^_\s])?)_(?!\w)/g, (_, lead: string, text: string) =>
          lead + styleText(text, 'italic')
        )
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
        .replace(/^\s*([-*_]\s*){3,}$/, '')
        .replace(/\s+$/, '')
    )
  const tableLines = classifyTableLines(raw)
  const flattened: string[] = []
  lines.forEach((line, index) => {
    const kind = tableLines[index]
    if (kind === 'separator') {
      // Dropped ENTIRELY rather than blanked. A blank here survives the collapse
      // below (its predecessor is the header), and Android's collapsed banner
      // shows two lines — so the header takes one, the blank takes the other,
      // and the content row falls below the fold.
      return
    }
    flattened.push(kind === 'row' ? flattenTableRow(line) : line)
  })
  return flattened
    .filter(
      (line, index, all) => line.trim() !== '' || (index > 0 && all[index - 1]!.trim() !== '')
    )
    .join('\n')
    .trim()
}

/** A GFM delimiter row, with or without the optional outer pipes. */
function isTableSeparator(line: string): boolean {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  if (!inner.includes('-')) {
    return false
  }
  return inner.split('|').every((cell) => /^\s*:?-+:?\s*$/.test(cell))
}

/**
 * Which lines belong to a table, decided over the whole text rather than line by
 * line.
 *
 * Two ways a line qualifies, because two different things can go wrong.
 *
 * A line fenced by pipes on both sides is a row by itself: notification bodies
 * are excerpts and can start part-way through a table, with the header and
 * delimiter cut off.
 *
 * GFM also makes those outer pipes OPTIONAL, so `Check | Result` is a real row —
 * and so is `ls | wc -l` in prose, which is indistinguishable in isolation. What
 * makes a table a table there is the DELIMITER row, so a bare row counts only
 * when a delimiter sits directly under its header. Demanding outer pipes was the
 * whole rule before, which let a raw `--- | ---` reach the shade.
 */
function classifyTableLines(lines: readonly string[]): ('row' | 'separator' | undefined)[] {
  const kinds: ('row' | 'separator' | undefined)[] = lines.map((line) =>
    // A body is an EXCERPT of an agent's turn, so it can begin part-way through
    // a table with the header and delimiter cut off. A line fenced by pipes on
    // both sides is a row on its own evidence, which is what keeps a truncated
    // table readable. It is also why a line of prose wrapped in pipes is
    // flattened: a mid-table excerpt is far likelier than that.
    /^\s*\|.+\|\s*$/.test(line) ? 'row' : undefined
  )
  lines.forEach((line, index) => {
    if (!isTableSeparator(line)) {
      return
    }
    // A VETO as well as an anchor, and unconditionally: nothing else in Markdown
    // looks like `--- | ---`, so it is a delimiter on its own evidence whatever
    // sits above it. An excerpt can begin AT one, and before this that left a
    // bare table entirely raw and flattened a piped one into "--- · ---" — the
    // outer-pipe rule above had already claimed it as a row.
    kinds[index] = 'separator'
    const header = index > 0 ? lines[index - 1] : undefined
    // A header only exists when there is a line above WITH cells in it.
    if (header !== undefined && header.includes('|')) {
      kinds[index - 1] = 'row'
    }
    for (let body = index + 1; body < lines.length; body += 1) {
      if (!lines[body]!.includes('|')) {
        break
      }
      kinds[body] = 'row'
    }
  })
  return kinds
}

/**
 * One table row as a single readable line. A table is a layout and the shade has
 * no columns, so cells are joined by a middot. Before this, a row kept every
 * pipe and an agent answering with a table filled the notification with "||||"
 * and no readable summary (reported from the phone 2026-09-17).
 */
function flattenTableRow(line: string): string {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '')
    .join(' \u00b7 ')
}

type TextStyle = 'bold' | 'italic' | 'bolditalic' | 'mono'

// Code points of the first glyph ("A", "a", "0") in each Mathematical
// Alphanumeric block. Sans-serif faces match the shade's own typeface.
const STYLE_BASES: Record<TextStyle, { upper: number; lower: number; digit: number | null }> = {
  bold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  italic: { upper: 0x1d608, lower: 0x1d622, digit: null },
  bolditalic: { upper: 0x1d63c, lower: 0x1d656, digit: 0x1d7ec },
  mono: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 }
}

export function styleText(text: string, style: TextStyle): string {
  const base = STYLE_BASES[style]
  let out = ''
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code >= 0x41 && code <= 0x5a) {
      out += String.fromCodePoint(base.upper + code - 0x41)
    } else if (code >= 0x61 && code <= 0x7a) {
      out += String.fromCodePoint(base.lower + code - 0x61)
    } else if (code >= 0x30 && code <= 0x39 && base.digit !== null) {
      out += String.fromCodePoint(base.digit + code - 0x30)
    } else {
      out += char
    }
  }
  return out
}
